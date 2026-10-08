import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { dirname } from "node:path";
import { validateClientExecutable } from "./binaries";
import { probeVaultMcp } from "./mcp-probe";
import { probeLocalHttp } from "./network";
import { RuntimeOutput, describeRuntimeExit, describeRuntimeSpawnError } from "./runtime-diagnostics";
import type { ConnectionSnapshot, ConnectionState, TunnelSettings } from "./types";
import { hasValidConfiguration, parseLocalMcpEndpoint } from "./validation";
import type { WindowsSecretStore } from "./windows";

const POLL_MS = 3_000;
const MAX_RETRY_MS = 60_000;
const MANAGED_HEALTH = new URL("http://127.0.0.1:8766/");
const FOREGROUND_HEALTH = new URL("http://127.0.0.1:8080/");

async function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_200, () => finish(false));
  });
}

/**
 * Stop the complete process tree on Windows; the official client starts
 * cloudflared.exe as a child. Only use a PID owned by this manager.
 */
function stopChildTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" || !child.pid) {
    child.kill();
    return;
  }

  const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  killer.once("error", () => child.kill());
  killer.once("exit", (code) => {
    if (code !== 0 && child.exitCode === null) child.kill();
  });
  killer.unref();
}

/**
 * One managed tunnel per workstation. The fixed loopback health port makes
 * duplicates and orphaned runtimes detectable after a crash or vault switch.
 */
export class TunnelManager {
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startPromise: Promise<void> | null = null;
  private polling = false;
  private disposed = false;
  private paused = false;
  private retryAt = 0;
  private failures = 0;

  private current: ConnectionSnapshot = {
    state: "stopped",
    detail: "Not running",
    managed: false,
  };

  constructor(
    private readonly settings: () => TunnelSettings,
    private readonly secrets: WindowsSecretStore,
    private readonly onUpdate: () => void,
  ) {}

  get snapshot(): ConnectionSnapshot {
    return { ...this.current };
  }

  private update(state: ConnectionState, detail: string, showDashboard = false): void {
    const next: ConnectionSnapshot = {
      state,
      detail,
      dashboardUrl: showDashboard ? new URL("/ui", MANAGED_HEALTH).toString() : undefined,
      managed: this.child !== null,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      this.current = next;
      this.onUpdate();
    }
  }

  begin(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  async connectNow(): Promise<void> {
    this.paused = false;
    this.retryAt = 0;
    await this.start();
  }

  disconnect(): void {
    this.paused = true;
    this.retryAt = Number.POSITIVE_INFINITY;
    const child = this.child;
    this.child = null;
    if (child) stopChildTree(child);
    this.update("stopped", "Stopped manually");
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.disconnect();
  }

  private async tick(): Promise<void> {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      if (this.child) {
        await this.checkHealth();
      } else if (this.paused) {
        this.update("stopped", "Stopped manually");
      } else if (this.settings().autoConnect && Date.now() >= this.retryAt) {
        await this.start();
      }
    } finally {
      this.polling = false;
    }
  }

  private async checkHealth(): Promise<void> {
    if (!this.child || this.disposed) return;
    const code = await probeLocalHttp(new URL("/readyz", MANAGED_HEALTH));
    if (!this.child || this.disposed) return;
    if (code === 200) {
      this.failures = 0;
      this.update("connected", "Tunnel ready", true);
    } else if (code === 503) {
      this.update("connecting", "Waiting for the tunnel to become ready", true);
    } else {
      this.update("connecting", "Starting the local tunnel health service", true);
    }
  }

  private async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.child || this.disposed) return;
    this.startPromise = this.startInner()
      .catch((error: unknown) => {
        this.scheduleRetry();
        const message = error instanceof Error ? error.message : "Connection failed";
        this.update("error", message);
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  private scheduleRetry(): void {
    const delay = Math.min(MAX_RETRY_MS, 4_000 * 2 ** Math.min(this.failures++, 4));
    this.retryAt = Date.now() + delay;
  }

  private async startInner(): Promise<void> {
    const config = this.settings();
    if (!hasValidConfiguration(config.clientPath, config.tunnelId, config.mcpUrl)) {
      this.update("not-configured", "Complete setup to connect");
      return;
    }
    if (!(await this.secrets.hasKey())) {
      this.update("not-configured", "Save the runtime API key");
      return;
    }

    await validateClientExecutable(config.clientPath);
    const endpoint = parseLocalMcpEndpoint(config.mcpUrl);
    if (!endpoint) throw new Error("Only local MCP servers are permitted.");

    // Check protocol identity, not just whether a process occupies the port.
    const result = await probeVaultMcp(config.mcpUrl);
    if (result === "unavailable") {
      this.update("waiting-for-obsidian", "Waiting for Vault as MCP on port " + endpoint.port);
      return;
    }
    if (result === "unexpected-server") {
      this.retryAt = Date.now() + 15_000;
      this.update("error", "The MCP endpoint does not identify as Vault as MCP.");
      return;
    }

    const tokenSaved = await this.secrets.hasMcpToken();
    if (result === "authentication-required" && !tokenSaved) {
      this.update("not-configured", "Vault as MCP requires a bearer token (Advanced settings)");
      return;
    }

    const mcpToken = tokenSaved ? await this.secrets.readMcpToken() : undefined;
    if (result === "authentication-required" && mcpToken) {
      const authenticated = await probeVaultMcp(config.mcpUrl, mcpToken);
      if (authenticated !== "ready") {
        this.retryAt = Date.now() + 30_000;
        this.update(
          "error",
          authenticated === "authentication-required"
            ? "Invalid Vault as MCP token. Update it in Advanced settings."
            : "The local MCP server could not be verified.",
        );
        return;
      }
    }

    // Only the managed health port is reserved. Other applications on :8080
    // must not prevent an otherwise independent local tunnel from running.
    if (await portOpen(MANAGED_HEALTH.hostname, Number(MANAGED_HEALTH.port))) {
      const healthy = await probeLocalHttp(new URL("/healthz", MANAGED_HEALTH));
      this.update(
        healthy === 200 ? "existing-runtime" : "error",
        healthy === 200
          ? "Another managed tunnel is already running. Stop it before connecting."
          : "Port 8766 is already occupied by another application.",
      );
      return;
    }

    // Recognize, but never touch, a foreground OpenAI client on :8080.
    const foregroundHealthy = await probeLocalHttp(new URL("/healthz", FOREGROUND_HEALTH));
    if (foregroundHealthy === 200) {
      const foregroundReady = await probeLocalHttp(new URL("/readyz", FOREGROUND_HEALTH));
      if (foregroundReady === 200 || foregroundReady === 503) {
        this.update(
          "existing-runtime",
          "An OpenAI tunnel is running on port 8080. Stop it before automatic management.",
        );
        return;
      }
    }

    this.update("starting", "Starting the tunnel");
    const runtimeKey = await this.secrets.readKey();
    if (this.disposed || this.paused) return;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CONTROL_PLANE_API_KEY: runtimeKey,
      CONTROL_PLANE_TUNNEL_ID: config.tunnelId.trim(),
      MCP_SERVER_URL: config.mcpUrl,
      CLOUDFLARED_MANAGED: "true",
      OPEN_WEB_UI: "false",
    };
    // Explicitly bound official behavior; do not accidentally inherit another
    // program's tunnel profiles, proxy targets, admin key or MCP headers.
    for (const name of [
      "MCP_EXTRA_HEADERS",
      "MCP_DISCOVERY_EXTRA_HEADERS",
      "TUNNEL_CLIENT_CONFIG",
      "TUNNEL_CLIENT_PROFILE",
      "TUNNEL_CLIENT_PROFILE_FILE",
      "CLOUDFLARED_PATH",
      "CLOUDFLARED_TUNNEL_TOKEN",
      "OPENAI_ADMIN_KEY",
    ]) delete env[name];
    if (mcpToken) env.MCP_EXTRA_HEADERS = "Authorization: Bearer " + mcpToken;

    const child = spawn(
      config.clientPath,
      ["run", "--health.listen-addr=127.0.0.1:8766", "--log.level=warn"],
      {
        windowsHide: true,
        cwd: dirname(config.clientPath),
        // Capture only bounded in-memory diagnostics. Never print or persist
        // output that may include runtime secrets or local vault contents.
        stdio: ["ignore", "pipe", "pipe"],
        env,
      },
    );
    const output = new RuntimeOutput();
    child.stdout?.on("data", (chunk: Buffer) => output.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.append(chunk));
    if (this.disposed || this.paused) {
      stopChildTree(child);
      return;
    }

    this.child = child;
    this.retryAt = 0;
    this.update("connecting", "Tunnel process launched", true);
    child.once("error", (error: NodeJS.ErrnoException) => {
      output.consume();
      this.onExit(child, describeRuntimeSpawnError(error));
    });
    child.once("close", (code) =>
      this.onExit(child, describeRuntimeExit(code, output.consume())),
    );
  }

  private onExit(child: ChildProcess, reason: string): void {
    if (this.child !== child) return;
    this.child = null;
    if (this.disposed || this.paused) {
      this.update("stopped", "Stopped");
      return;
    }
    this.scheduleRetry();
    this.update("error", reason);
  }
}

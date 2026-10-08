import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { validateClientExecutable } from "./binaries";
import { probeLocalHttp } from "./network";
import type { ConnectionSnapshot, ConnectionState, TunnelSettings } from "./types";
import { hasValidConfiguration, parseHealthBaseUrl, parseLocalMcpEndpoint } from "./validation";
import { localDataDirectory, type WindowsSecretStore } from "./windows";

const POLL_INTERVAL_MS = 3_000;
const RESTART_MAX_MS = 60_000;
const EXTERNAL_HEALTH = new URL("http://127.0.0.1:8080/healthz");

async function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1200, () => finish(false));
  });
}

/** Own only subprocesses launched by this plugin. Never terminate an external runtime. */
export class TunnelManager {
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startPromise: Promise<void> | null = null;
  private polling = false;
  private disposed = false;
  private paused = false;
  private retryAt = 0;
  private failures = 0;
  private healthFile: string | null = null;
  private healthUrl: URL | null = null;

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

  private update(state: ConnectionState, detail: string): void {
    const dashboardUrl = this.healthUrl ? new URL("/ui", this.healthUrl).toString() : undefined;
    const next: ConnectionSnapshot = {
      state,
      detail,
      dashboardUrl,
      managed: this.child !== null,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      this.current = next;
      this.onUpdate();
    }
  }

  begin(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
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
    this.healthUrl = null;
    if (child) child.kill();
    this.update("stopped", "Stopped");
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.disconnect();
    if (this.healthFile) void rm(this.healthFile, { force: true });
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
    if (!this.healthUrl && this.healthFile) {
      try {
        const value = await readFile(this.healthFile, "utf8");
        this.healthUrl = parseHealthBaseUrl(value);
      } catch {
        // The tunnel writes this file after its health listener starts.
      }
    }
    if (!this.healthUrl) {
      this.update("starting", "Waiting for tunnel-client");
      return;
    }
    const code = await probeLocalHttp(new URL("/readyz", this.healthUrl));
    if (code === 200) {
      this.failures = 0;
      this.update("connected", "Tunnel ready");
    } else if (code === 503) {
      this.update("connecting", "Waiting for tunnel readiness");
    } else {
      this.update("connecting", "Checking local tunnel status");
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
    const delay = Math.min(RESTART_MAX_MS, 4_000 * 2 ** Math.min(this.failures++, 4));
    this.retryAt = Date.now() + delay;
  }

  private async startInner(): Promise<void> {
    const config = this.settings();
    if (!hasValidConfiguration(config.clientPath, config.tunnelId, config.mcpUrl)) {
      this.update("not-configured", "Complete setup to connect");
      return;
    }
    if (!(await this.secrets.hasKey())) {
      this.update("not-configured", "Save a runtime API key");
      return;
    }
    await validateClientExecutable(config.clientPath);

    const target = parseLocalMcpEndpoint(config.mcpUrl);
    if (!target) throw new Error("Only local MCP servers are permitted.");
    const host = target.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (!(await isPortListening(host, Number(target.port)))) {
      this.update("waiting-for-obsidian", "Waiting for Vault as MCP on port " + target.port);
      return;
    }

    // Manual foreground clients usually bind :8080. Avoid a duplicate tunnel.
    if (await probeLocalHttp(EXTERNAL_HEALTH) === 200) {
      this.update("existing-runtime", "An existing tunnel client is using port 8080");
      return;
    }

    this.update("starting", "Starting tunnel");
    const runtimeKey = await this.secrets.readKey();
    const runtimeDir = join(localDataDirectory(), "runtime");
    await mkdir(runtimeDir, { recursive: true });
    const healthFile = join(runtimeDir, "health-" + randomUUID() + ".url");

    if (this.disposed || this.paused) return;
    this.healthFile = healthFile;
    this.healthUrl = null;
    const child = spawn(
      config.clientPath,
      [
        "run",
        "--health.listen-addr=127.0.0.1:0",
        "--health.url-file=" + healthFile,
        "--log.level=warn",
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          CONTROL_PLANE_API_KEY: runtimeKey,
          CONTROL_PLANE_TUNNEL_ID: config.tunnelId.trim(),
          MCP_SERVER_URL: config.mcpUrl,
          OPEN_WEB_UI: "false",
        },
      },
    );
    if (this.disposed || this.paused) {
      child.kill();
      return;
    }
    this.child = child;
    this.retryAt = 0;
    this.update("connecting", "Tunnel client started");
    child.once("error", () => this.onExit(child, "Unable to launch tunnel-client.exe"));
    child.once("close", (code) => this.onExit(child, "Tunnel exited" + (code === null ? "" : " (code " + code + ")")));
  }

  private onExit(child: ChildProcess, reason: string): void {
    if (this.child !== child) return;
    this.child = null;
    this.healthUrl = null;
    if (this.healthFile) void rm(this.healthFile, { force: true });
    this.healthFile = null;
    if (this.disposed || this.paused) {
      this.update("stopped", "Stopped");
      return;
    }
    this.scheduleRetry();
    this.update("error", reason + ". Will retry.");
  }
}

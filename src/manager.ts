import type { ChildProcess } from "node:child_process";
import type { WindowsSecretStore } from "./windows";
import { hasValidConfiguration } from "./validation";
import { runtimeServices, type RuntimeServices } from "./runtime-services";
import { RuntimeOutput, classifyRuntimeExit, describeRuntimeSpawnError, type RuntimeFailure } from "./runtime-diagnostics";
import type { ConnectionSnapshot, ConnectionState, TunnelSettings } from "./types";

const POLL_MS = 3000;
const STARTUP_MS = 60_000;
const LOST_HEALTH_MS = 15_000;
const HEALTH = new URL("http://127.0.0.1:8766/");
type SecretStore = Pick<WindowsSecretStore, "hasKey" | "readKey" | "hasMcpToken" | "readMcpToken">;

/** A single, cancellable session. Start/stop transitions are never overlapped. */
export class TunnelManager {
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private attempt: Promise<void> | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private retiring = new Set<ChildProcess>();
  private generation = 0;
  private wanted = false;
  private touched = false;
  private disposed = false;
  private polling = false;
  private failures = 0;
  private retryAt = 0;
  private launchedAt = 0;
  private healthyAt: number | null = null;
  private firstHealthyAt: number | null = null;
  private readonly io: RuntimeServices;
  private current: ConnectionSnapshot = { state: "stopped", detail: "Not running", managed: false };

  constructor(
    private readonly settings: () => TunnelSettings,
    private readonly secrets: SecretStore,
    private readonly onUpdate: () => void,
    services: Partial<RuntimeServices> = {},
  ) { this.io = { ...runtimeServices, ...services }; }

  get snapshot(): ConnectionSnapshot { return { ...this.current }; }
  get activeSession(): boolean { return this.wanted; }

  private update(state: ConnectionState, detail: string, dashboard = false): void {
    const next: ConnectionSnapshot = {
      state, detail, managed: this.child !== null,
      dashboardUrl: dashboard ? new URL("/ui", HEALTH).href : undefined,
      retryAt: state === "error" && this.wanted && this.retryAt > 0 ? this.retryAt : undefined,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      this.current = next; this.onUpdate();
    }
  }

  begin(): void {
    if (this.timer || this.disposed) return;
    if (!this.touched) this.wanted = this.settings().autoConnect;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  async connectNow(): Promise<void> {
    if (this.disposed) return;
    this.touched = true; this.wanted = true; this.retryAt = 0;
    if (this.child && !this.retiring.has(this.child)) return;
    const run = ++this.generation;
    const pending = this.attempt;
    if (pending) await pending;
    try { await this.stopping; } catch { return; }
    if (this.live(run)) await this.start(run);
  }

  async disconnect(): Promise<void> {
    this.touched = true; this.wanted = false; this.retryAt = 0;
    const run = ++this.generation;
    const child = this.child;
    if (!child) { this.update("stopped", "Stopped"); return; }
    this.update("stopping", "Stopping the tunnel…");
    try {
      await this.stop(child);
      if (run === this.generation && !this.wanted) this.update("stopped", "Stopped");
    } catch {
      if (run === this.generation) this.update("error", "The previous tunnel did not stop. Check its process before reconnecting.");
      throw new Error("The previous tunnel could not be stopped safely.");
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.disconnect().catch(() => undefined);
  }

  private live(run: number): boolean {
    return !this.disposed && this.wanted && this.generation === run;
  }

  private async stop(child: ChildProcess): Promise<void> {
    if (this.retiring.has(child)) return this.stopping;
    this.retiring.add(child);
    const task = this.io.stop(child).then(() => {
      if (this.child === child) this.child = null;
    }).finally(() => this.retiring.delete(child));
    this.stopping = task;
    // Keep a rejected stop visible and handled; never start over a surviving child.
    void task.catch(() => undefined);
    return task;
  }

  private fail(failure: RuntimeFailure): void {
    if (!this.wanted || this.disposed) return;
    if (failure.retryable) {
      this.retryAt = this.io.now() + Math.min(60_000, 4000 * 2 ** Math.min(this.failures++, 4));
    } else { this.wanted = false; this.retryAt = 0; }
    this.update("error", failure.message);
  }

  private async tick(): Promise<void> {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      if (this.child && !this.retiring.has(this.child)) await this.checkHealth();
      else if (!this.child && this.wanted && this.io.now() >= this.retryAt) {
        try { await this.stopping; } catch { return; }
        if (!this.attempt) await this.start(this.generation);
      }
    } catch {
      this.fail({ message: "The connection check failed. Retry or review the local settings.", retryable: true });
    } finally { this.polling = false; }
  }

  private async start(run: number): Promise<void> {
    if (this.attempt) return this.attempt;
    if (this.child || !this.live(run)) return;
    const task = this.preflight(run).catch(() => {
      if (this.live(run)) this.fail({ message: "Could not prepare the client. Check the selected executable and saved credentials.", retryable: false });
    });
    this.attempt = task;
    try { await task; } finally { if (this.attempt === task) this.attempt = null; }
  }

  private async preflight(run: number): Promise<void> {
    const config = { ...this.settings() };
    if (!hasValidConfiguration(config.clientPath, config.tunnelId, config.mcpUrl)) {
      this.update("not-configured", "Complete setup to connect"); return;
    }
    this.update("starting", "Checking the local connection…");
    const hasKey = await this.secrets.hasKey();
    if (!this.live(run)) return;
    if (!hasKey) { this.update("not-configured", "Save the runtime API key"); return; }
    await this.io.validate(config.clientPath);
    if (!this.live(run)) return;
    const result = await this.io.probe(config.mcpUrl);
    if (!this.live(run)) return;
    if (result === "unavailable") { this.update("waiting-for-obsidian", "Waiting for the local Vault as MCP server"); return; }
    if (result === "unexpected-server") {
      this.fail({ message: "The local endpoint is not Vault as MCP. Check the endpoint in connection settings.", retryable: false }); return;
    }
    const saved = await this.secrets.hasMcpToken();
    if (!this.live(run)) return;
    if (result === "authentication-required" && !saved) {
      this.update("not-configured", "Add the Vault as MCP bearer token in connection settings"); return;
    }
    const token = saved ? await this.secrets.readMcpToken() : undefined;
    if (!this.live(run)) return;
    if (result === "authentication-required") {
      const auth = await this.io.probe(config.mcpUrl, token);
      if (!this.live(run)) return;
      if (auth !== "ready") {
        this.fail({ message: "The local MCP token was rejected or the server could not be verified. Check connection settings.", retryable: false }); return;
      }
    }
    const occupied = await this.io.portOpen(8766);
    if (!this.live(run)) return;
    if (occupied) {
      this.update("existing-runtime", "Port 8766 is already in use. Other processes will not be stopped.");
      this.retryAt = this.io.now() + 10_000; return;
    }
    const foreground = await this.io.http(new URL("http://127.0.0.1:8080/healthz"));
    if (!this.live(run)) return;
    if (foreground === 200) {
      const ready = await this.io.http(new URL("http://127.0.0.1:8080/readyz"));
      if (!this.live(run)) return;
      if (ready === 200 || ready === 503) {
        this.update("existing-runtime", "A client is already listening on port 8080. Close the manually started tunnel before using this one.");
        this.retryAt = this.io.now() + 10_000; return;
      }
    }
    const key = await this.secrets.readKey();
    if (!this.live(run)) return;
    const child = this.io.launch(config, key, token);
    const output = new RuntimeOutput();
    this.child = child;
    this.launchedAt = this.io.now(); this.healthyAt = null; this.firstHealthyAt = null; this.retryAt = 0;
    child.stdout?.on("data", (chunk: Buffer) => output.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.append(chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      output.consume();
      this.onExit(child, { message: describeRuntimeSpawnError(error), retryable: false });
    });
    child.once("close", (code) => this.onExit(child, classifyRuntimeExit(code, output.consume())));
    this.update("connecting", "Starting the OpenAI tunnel…");
  }

  private onExit(child: ChildProcess, failure: RuntimeFailure): void {
    if (this.child !== child || this.retiring.has(child)) return;
    this.child = null;
    this.stopping = Promise.resolve();
    if (!this.wanted || this.disposed) { this.update("stopped", "Stopped"); return; }
    this.fail(failure);
  }

  private async checkHealth(): Promise<void> {
    const child = this.child;
    const run = this.generation;
    if (!child) return;
    const code = await this.io.http(new URL("/readyz", HEALTH));
    if (this.child !== child || this.retiring.has(child) || !this.live(run)) return;
    const now = this.io.now();
    if (code === 200) {
      this.healthyAt = now;
      this.firstHealthyAt ??= now;
      if (now - this.firstHealthyAt >= 20_000) this.failures = 0;
      this.update("connected", "Local tunnel ready", true); return;
    }
    const expired = this.healthyAt === null ? now - this.launchedAt > STARTUP_MS : now - this.healthyAt > LOST_HEALTH_MS;
    if (expired) {
      const message = this.healthyAt === null
        ? "The client did not become ready within 60 seconds. Check credentials or network access."
        : "The client stopped responding. The tunnel will reconnect.";
      try {
        await this.stop(child);
        if (this.live(run)) this.fail({ message, retryable: true });
      } catch {
        if (this.live(run)) this.fail({ message: "The unresponsive client could not be stopped. Check its process before retrying.", retryable: false });
      }
    } else this.update("connecting", this.healthyAt === null ? "Waiting for the tunnel service…" : "Reconnecting to the tunnel service…", code !== null);
  }
}

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { validateClientExecutable } from "./binaries";
import { probeVaultMcp } from "./mcp-probe";
import { probeLocalHttp } from "./network";
import { clientEnvironment } from "./runtime-environment";
import type { TunnelSettings } from "./types";

export interface RuntimeServices {
  validate(path: string): Promise<void>;
  probe(endpoint: string, token?: string): ReturnType<typeof probeVaultMcp>;
  http(url: URL): Promise<number | null>;
  portOpen(port: number): Promise<boolean>;
  launch(config: TunnelSettings, key: string, token?: string): ChildProcess;
  stop(child: ChildProcess): Promise<void>;
  now(): number;
}

/** A non-default log level requires an explicit structured format upstream. */
export function clientLaunchArguments(): string[] {
  return ["run", "--health.listen-addr=127.0.0.1:8766", "--log.format=struct-text", "--log.level=warn"];
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true; socket.destroy(); resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1200, () => finish(false));
  });
}

/** Wait for the owned process tree to stop before allowing a replacement. */
export function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    let killer: ChildProcess | undefined;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener("close", closed);
      if (error) reject(error); else resolve();
    };
    const closed = (): void => finish();
    const timer = setTimeout(() => {
      killer?.kill();
      finish(new Error("The previous tunnel did not stop. Close Obsidian and check its process before reconnecting."));
    }, 8000);
    child.once("close", closed);
    try {
      if (process.platform !== "win32" || !child.pid) {
        child.kill();
      } else {
        const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
        killer = spawn(executable, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true, stdio: "ignore",
        });
        killer.once("error", () => finish(new Error("Windows could not stop the owned tunnel process.")));
        killer.once("close", (code) => {
          // A successful taskkill still must be followed by the owned child's close event.
          if (code === 0) return;
          else if (child.exitCode !== null || child.signalCode !== null) finish();
          else finish(new Error("Windows could not stop the owned tunnel process."));
        });
      }
    } catch {
      finish(new Error("The owned tunnel process could not be stopped."));
    }
  });
}

export const runtimeServices: RuntimeServices = {
  validate: validateClientExecutable,
  probe: probeVaultMcp,
  http: (url) => probeLocalHttp(url),
  portOpen,
  launch: (config, key, token) => spawn(config.clientPath, clientLaunchArguments(), {
    windowsHide: true, cwd: dirname(config.clientPath),
    stdio: ["ignore", "pipe", "pipe"],
    env: clientEnvironment(process.env, config, key, token),
  }),
  stop: stopOwnedProcess,
  now: () => Date.now(),
};

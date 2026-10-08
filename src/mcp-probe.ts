import { request } from "node:http";
import { parseLocalMcpEndpoint } from "./validation";

export type VaultMcpProbeState =
  | "ready"
  | "authentication-required"
  | "unavailable"
  | "unexpected-server";

const LIMIT = 16 * 1024;

/**
 * Read-only JSON-RPC initialize. Unlike checking whether :8765 is open, this
 * confirms the listener identifies itself as Vault as MCP.
 *
 * Never sends a request to a remote host or calls a tool that reads notes.
 */
export async function probeVaultMcp(endpoint: string, token?: string): Promise<VaultMcpProbeState> {
  const url = parseLocalMcpEndpoint(endpoint);
  if (!url) return "unexpected-server";

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: "chatgpt-mcp-tunnel-identity-check",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "chatgpt-mcp-tunnel", version: "0.4.0" },
      capabilities: {},
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (state: VaultMcpProbeState): void => {
      if (settled) return;
      settled = true;
      resolve(state);
    };
    const req = request(
      url,
      {
        method: "POST",
        timeout: 2_000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload, "utf8")),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
      },
      (res) => {
        const code = res.statusCode;
        if (code === 401 || code === 403) {
          res.resume();
          finish("authentication-required");
          return;
        }
        if (code !== 200) {
          res.resume();
          finish("unexpected-server");
          return;
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
          if (data.length > LIMIT) {
            finish("unexpected-server");
            req.destroy();
          }
        });
        res.once("error", () => finish("unavailable"));
        res.once("end", () => {
          if (settled) return;
          try {
            const message: unknown = JSON.parse(data);
            if (typeof message !== "object" || message === null) {
              finish("unexpected-server");
              return;
            }
            const body = message as {
              jsonrpc?: unknown;
              result?: { serverInfo?: { name?: string } };
            };
            finish(
              body.jsonrpc === "2.0" && body.result?.serverInfo?.name === "obsidian-vault-mcp"
                ? "ready"
                : "unexpected-server",
            );
          } catch {
            finish("unexpected-server");
          }
        });
      },
    );
    req.once("error", () => finish("unavailable"));
    req.once("timeout", () => {
      req.destroy();
      finish("unavailable");
    });
    req.end(payload);
  });
}

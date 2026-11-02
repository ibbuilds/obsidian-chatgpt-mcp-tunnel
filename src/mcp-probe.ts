import { request } from "node:http";
import { parseLocalMcpEndpoint } from "./validation";

export type VaultMcpProbeState = "ready" | "authentication-required" | "unavailable" | "unexpected-server" | "missing-tools";
export interface VaultMcpReport { state: VaultMcpProbeState; toolCount: number; writable: boolean }
type Rpc = { jsonrpc?: string; id?: string; result?: { serverInfo?: { name?: string }; protocolVersion?: string; tools?: Array<{ name?: string }> }; error?: unknown };
type Reply = { status: number; body?: Rpc; session?: string };
const LIMIT = 512 * 1024;
const READ_TOOLS = ["list_notes", "search_notes", "read_note"];

/** Absolute deadlines also bound SSE streams that never close or keep sending heartbeats. */
function rpc(url: URL, method: string, id: string | undefined, params: unknown, token?: string, session?: string, protocol?: string): Promise<Reply> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reply: Reply): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(reply); req.destroy();
    };
    const payload = JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, ...(params === undefined ? {} : { params }) });
    const req = request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(session ? { "Mcp-Session-Id": session } : {}),
        ...(protocol ? { "MCP-Protocol-Version": protocol } : {}),
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const rawSession = res.headers["mcp-session-id"];
      const receivedSession = typeof rawSession === "string" && /^[\x21-\x7e]{1,256}$/.test(rawSession) ? rawSession : undefined;
      if (status !== 200 || !id) { res.resume(); finish({ status, session: receivedSession }); return; }
      const sse = res.headers["content-type"]?.includes("text/event-stream");
      let data = "", bytes = 0;
      const parse = (value: string): boolean => {
        try {
          const body = JSON.parse(value) as Rpc;
          if (body?.jsonrpc === "2.0" && body.id === id) { finish({ status, body, session: receivedSession }); return true; }
        } catch { /* Wait for the complete response/event, never expose its content. */ }
        return false;
      };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > LIMIT) { finish({ status: 0 }); return; }
        data += chunk;
        if (sse) {
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(data))) {
            const event = data.slice(0, match.index); data = data.slice(match.index + match[0].length);
            const json = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
            if (json && parse(json)) return;
          }
        }
      });
      res.once("end", () => { if (!settled && (!data || !parse(data))) finish({ status }); });
      res.once("error", () => finish({ status: 0 }));
      res.once("aborted", () => finish({ status: 0 }));
    });
    const timer = setTimeout(() => finish({ status: 0 }), 2500);
    req.once("error", () => finish({ status: 0 }));
    req.end(payload);
  });
}

async function closeSession(url: URL, session: string, token?: string, protocol?: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = request(url, { method: "DELETE", headers: {
      "Mcp-Session-Id": session, ...(protocol ? { "MCP-Protocol-Version": protocol } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    } }, res => { res.resume(); done(); });
    const timer = setTimeout(done, 500);
    function done(): void { clearTimeout(timer); req.destroy(); resolve(); }
    req.once("error", done); req.end();
  });
}

/** Discover real tools without calling any tool or reading note contents. */
export async function inspectVaultMcp(endpoint: string, token?: string, tools = true): Promise<VaultMcpReport> {
  const report = (state: VaultMcpProbeState, toolCount = 0, writable = false): VaultMcpReport => ({ state, toolCount, writable });
  const url = parseLocalMcpEndpoint(endpoint);
  if (!url) return report("unexpected-server");
  const init = await rpc(url, "initialize", "chatgpt-mcp-tunnel-identity-check", {
    protocolVersion: "2025-06-18", clientInfo: { name: "chatgpt-mcp-tunnel", version: "0.9.1" }, capabilities: {},
  }, token);
  const result = init.body?.result;
  const protocol = typeof result?.protocolVersion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.protocolVersion) ? result.protocolVersion : "2025-06-18";
  const state = (status: number): VaultMcpProbeState => status === 401 || status === 403 ? "authentication-required" : status === 0 ? "unavailable" : "unexpected-server";
  try {
    if (init.status !== 200) return report(state(init.status));
    if (result?.serverInfo?.name !== "obsidian-vault-mcp" || init.body?.error) return report("unexpected-server");
    if (!tools) return report("ready");
    const initialized = await rpc(url, "notifications/initialized", undefined, undefined, token, init.session, protocol);
    if (![200, 202, 204].includes(initialized.status)) return report(state(initialized.status));
    const listed = await rpc(url, "tools/list", "chatgpt-mcp-tunnel-tools-check", {}, token, init.session, protocol);
    if (listed.status !== 200) return report(state(listed.status));
    const definitions = listed.body?.result?.tools;
    if (!Array.isArray(definitions) || listed.body?.error) return report("missing-tools");
    const names = new Set(definitions.map(tool => tool?.name).filter((name): name is string => typeof name === "string"));
    return report(READ_TOOLS.every(name => names.has(name)) ? "ready" : "missing-tools", names.size,
      names.has("create_note") && (names.has("patch_note") || names.has("update_note")));
  } finally { if (init.session) await closeSession(url, init.session, token, protocol); }
}

/** Lightweight identity check for periodic local-server health monitoring. */
export async function probeVaultMcp(endpoint: string, token?: string): Promise<VaultMcpProbeState> {
  return (await inspectVaultMcp(endpoint, token, false)).state;
}

export async function probeVaultTools(endpoint: string, token?: string): Promise<VaultMcpProbeState> {
  return (await inspectVaultMcp(endpoint, token)).state;
}

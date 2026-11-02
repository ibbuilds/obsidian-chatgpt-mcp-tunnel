import type { App } from "obsidian";
import { parseLocalMcpEndpoint } from "./validation";

export const VAULT_MCP_ID = "vault-as-mcp";

interface VaultServer {
  startServer?(): Promise<void>;
  getServerStatus?(): string;
  serverPort?(): number;
  tlsEnabled?(): boolean;
  bearerToken?(): string | undefined;
}
type PluginAccess = { getPlugin?(id: string): VaultServer | null; enablePluginAndSave?(id: string): Promise<void> };

function access(app: App): PluginAccess | undefined {
  return (app as App & { plugins?: PluginAccess }).plugins;
}

/** Guarded lifecycle adapter: Vault as MCP still owns its server and permissions. */
export async function startVaultServer(app: App, explicit = false): Promise<void> {
  const plugins = access(app);
  let server = plugins?.getPlugin?.(VAULT_MCP_ID);
  if (!server && explicit) {
    const installed = await isVaultAsMcpInstalled(app);
    if (!installed) throw new Error("Install Vault as MCP using the link below, then choose Set up local connection again.");
    if (!plugins?.enablePluginAndSave) throw new Error("Enable Vault as MCP in Community plugins, then check again.");
    await plugins.enablePluginAndSave(VAULT_MCP_ID);
    server = plugins.getPlugin?.(VAULT_MCP_ID);
  }
  if (!server) return;
  const status = server.getServerStatus?.();
  if (status === "running" || (status === "error" && !explicit)) return;
  if (server.startServer) await server.startServer();
}

export function vaultConnectionDetails(app: App): { endpoint: string; token: string } | null {
  const server = access(app)?.getPlugin?.(VAULT_MCP_ID);
  const port = server?.serverPort?.();
  if (!server || !Number.isInteger(port) || !port || port < 1 || port > 65535) return null;
  if (server.tlsEnabled?.()) throw new Error("Vault as MCP uses HTTPS. This bridge needs its local HTTP endpoint; review Vault as MCP settings.");
  const endpoint = "http://127.0.0.1:" + port + "/mcp";
  if (!parseLocalMcpEndpoint(endpoint)) return null;
  return { endpoint, token: server.bearerToken?.()?.trim() || "" };
}

export async function isVaultAsMcpInstalled(app: App): Promise<boolean> {
  return app.vault.adapter.exists(app.vault.configDir + "/plugins/" + VAULT_MCP_ID + "/manifest.json");
}

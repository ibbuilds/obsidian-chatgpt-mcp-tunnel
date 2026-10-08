import type { App } from "obsidian";
import { probeLocalHttp } from "./network";
import { parseLocalMcpEndpoint } from "./validation";

export const VAULT_MCP_ID = "vault-as-mcp";

export interface VaultMcpStatus {
  installed: boolean;
  endpointResponding: boolean;
}

/**
 * The other plugin owns MCP startup; we only inspect its installation and
 * whether its configured loopback endpoint responds to an HTTP request.
 *
 * We intentionally do not reach into the other plugin's private API.
 */
export async function inspectVaultAsMcp(app: App, endpoint: string): Promise<VaultMcpStatus> {
  const configDir = app.vault.configDir;
  const manifest = configDir + "/plugins/" + VAULT_MCP_ID + "/manifest.json";
  const installed = await app.vault.adapter.exists(manifest);
  const url = parseLocalMcpEndpoint(endpoint);
  const status = url ? await probeLocalHttp(url) : null;
  return { installed, endpointResponding: status !== null };
}

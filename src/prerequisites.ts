import type { App } from "obsidian";
import { probeVaultMcp } from "./mcp-probe";

export const VAULT_MCP_ID = "vault-as-mcp";

export interface VaultMcpStatus {
  installed: boolean;
  endpointResponding: boolean;
  authenticationRequired: boolean;
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
  const status = await probeVaultMcp(endpoint);
  return {
    installed,
    endpointResponding: status === "ready" || status === "authentication-required",
    authenticationRequired: status === "authentication-required",
  };
}

export interface TunnelSettings {
  clientPath: string;
  tunnelId: string;
  mcpUrl: string;
  autoConnect: boolean;
  /** User acknowledgement, never a remote discovery check. */
  chatgptLinked?: boolean;
}
export const DEFAULT_SETTINGS: TunnelSettings = {
  clientPath: "", tunnelId: "", mcpUrl: "http://127.0.0.1:8765/mcp", autoConnect: true,
};
export type ConnectionState = "not-configured" | "waiting-for-obsidian" | "starting" | "connecting" | "connected" | "stopping" | "existing-runtime" | "stopped" | "error";
export interface ConnectionSnapshot {
  state: ConnectionState;
  detail: string;
  dashboardUrl?: string;
  managed: boolean;
  /** Time of the next automatic attempt, if one is actually scheduled. */
  retryAt?: number;
}

/** Ignore unknown persisted fields and malformed types without losing valid settings. */
export function normalizeSettings(value: unknown): TunnelSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    clientPath: typeof raw.clientPath === "string" ? raw.clientPath.trim() : "",
    tunnelId: typeof raw.tunnelId === "string" ? raw.tunnelId.trim() : "",
    mcpUrl: typeof raw.mcpUrl === "string" ? raw.mcpUrl.trim() : DEFAULT_SETTINGS.mcpUrl,
    autoConnect: typeof raw.autoConnect === "boolean" ? raw.autoConnect : true,
    chatgptLinked: raw.chatgptLinked === true,
  };
}

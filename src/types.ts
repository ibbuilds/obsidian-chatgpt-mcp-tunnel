export interface TunnelSettings {
  clientPath: string;
  tunnelId: string;
  mcpUrl: string;
  autoConnect: boolean;
  /** Acknowledged by the user, not a remote verification. */
  chatgptLinked?: boolean;
}
export const DEFAULT_SETTINGS: TunnelSettings = {
  clientPath: "", tunnelId: "", mcpUrl: "http://127.0.0.1:8765/mcp", autoConnect: true,
};
export type ConnectionState = "not-configured" | "waiting-for-obsidian" | "starting" | "connecting" | "connected" | "existing-runtime" | "stopped" | "error";
export interface ConnectionSnapshot {
  state: ConnectionState;
  detail: string;
  dashboardUrl?: string;
  managed: boolean;
}

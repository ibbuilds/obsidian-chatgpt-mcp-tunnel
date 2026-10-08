// OpenAI accepts lowercase alphanumeric tunnel IDs and optional 4-character namespaces.
const TUNNEL_ID = /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);

export function isValidTunnelId(value: string): boolean {
  return TUNNEL_ID.test(value.trim());
}

/** Only local MCP endpoints are permitted: never proxy an arbitrary network URL. */
export function parseLocalMcpEndpoint(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(url.hostname) ||
      !url.port || Number(url.port) < 1 ||
      url.pathname !== "/mcp" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** The client writes a base URL, or a health URL on older builds. */
export function parseHealthBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(url.hostname) ||
      !url.port || Number(url.port) < 1 ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["/", "/healthz", "/readyz"].includes(url.pathname)
    ) {
      return null;
    }
    url.pathname = "/";
    return url;
  } catch {
    return null;
  }
}

export function hasValidConfiguration(
  clientPath: string,
  tunnelId: string,
  mcpUrl: string,
): boolean {
  return Boolean(clientPath.trim()) && isValidTunnelId(tunnelId) && parseLocalMcpEndpoint(mcpUrl) !== null;
}

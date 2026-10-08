import type { TunnelSettings } from "./types";

/**
 * Do not inherit another shell's tunnel profile, routing, credentials, or raw
 * HTTP logging. Preserve OS variables and ordinary network proxy configuration.
 * The supported direct-polling route is OpenAI's default; managed cloudflared
 * is OPTIONAL upstream and must not be forced on an already-working tunnel.
 */
export function clientEnvironment(
  source: NodeJS.ProcessEnv, config: TunnelSettings, key: string, token?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (/^(CONTROL_PLANE_|MCP_|CLOUDFLARED_|TUNNEL_CLIENT_|OPENAI_|HEALTH_|LOG_|ADMIN_UI_)/i.test(name)) continue;
    if (/^(OPEN_WEB_UI|PID_FILE)$/i.test(name)) continue;
    env[name] = value;
  }
  Object.assign(env, {
    CONTROL_PLANE_BASE_URL: "https://api.openai.com",
    CONTROL_PLANE_API_KEY: key,
    CONTROL_PLANE_TUNNEL_ID: config.tunnelId.trim(),
    MCP_SERVER_URL: config.mcpUrl,
    CLOUDFLARED_MANAGED: "false",
    OPEN_WEB_UI: "false",
    LOG_HTTP_RAW_UNSAFE: "false",
  });
  if (token) env.MCP_EXTRA_HEADERS = "Authorization: Bearer " + token;
  return env;
}

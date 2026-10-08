/**
 * Keep process output in memory only, never in Obsidian data.json or logs.
 * Classification returns controlled text: untrusted runtime logs may contain
 * credentials, Authorization headers or vault content.
 */
const MAX_OUTPUT_CHARS = 32_768;

export class RuntimeOutput {
  private tail = "";

  append(chunk: string | Buffer): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.tail = (this.tail + text).slice(-MAX_OUTPUT_CHARS);
  }

  consume(): string {
    const text = this.tail;
    this.tail = "";
    return text;
  }
}

/** Never interpolate client stdout/stderr, paths or credentials into the UI. */
export function describeRuntimeExit(code: number | null, output: string): string {
  const log = output.slice(-MAX_OUTPUT_CHARS).toLowerCase();

  if (/unknown flag|flag provided but not defined|unrecognized option|unknown option|unknown shorthand flag/.test(log)) {
    return "The selected OpenAI tunnel client is incompatible with these launch options. Install the latest official client.";
  }
  if (/tunnel[- _]?id[^\n]{0,60}(invalid|required|missing)|invalid[^\n]{0,60}tunnel[- _]?id/.test(log)) {
    return "The Tunnel ID was rejected by the client. Check it under OpenAI connection details.";
  }
  if (/api[- _]?key[^\n]{0,70}(required|missing|not set)|control[- _]?plane[^\n]{0,70}api[- _]?key[^\n]{0,40}(required|missing)/.test(log)) {
    return "The client did not receive a runtime API key. Save a restricted key under OpenAI connection details.";
  }
  if (/401|403|unauthorized|forbidden|invalid api[- _]?key|authentication failed|permission denied by the control plane/.test(log)) {
    return "OpenAI rejected the tunnel credentials or permissions. Verify the runtime API key, Tunnel ID, and Tunnels Read + Use access.";
  }
  if (/cloudflared[^\n]{0,150}(failed|missing|not found|exited|timeout|denied|cannot|could not|error)|(?:failed|missing|cannot|could not)[^\n]{0,90}cloudflared/.test(log)) {
    return "The bundled cloudflared process failed. Reinstall the official client and check whether Windows Security blocked it.";
  }
  if (/address already in use|listen tcp[^\n]{0,100}bind|only one usage of each socket address|eaddrinuse/.test(log)) {
    return "The client could not open its local health listener (port 8766). Check for another tunnel process using this port.";
  }
  if (/x509:|certificate verify failed|certificate[^\n]{0,80}(untrusted|expired)|tls handshake/.test(log)) {
    return "The client encountered a TLS certificate error. Check the network, system clock, or HTTPS inspection settings.";
  }
  if (/429|too many requests|rate limit exceeded/.test(log)) {
    return "OpenAI or the tunnel service is rate-limiting requests. Wait briefly and retry.";
  }
  if (/connection refused|no such host|network is unreachable|i\/o timeout|context deadline exceeded|no route to host|name resolution/.test(log)) {
    return "The client could not reach a required service. Check the network connection, VPN, firewall, or proxy.";
  }
  if (/invalid configuration|failed to parse config|configuration file[^\n]{0,50}(error|invalid)/.test(log)) {
    return "The client rejected its configuration. Select the latest official client and try again.";
  }
  const exit = code === null ? "unexpectedly" : "with code " + String(code);
  return "The OpenAI tunnel client exited " + exit + ". The cause was not identified; check the saved runtime key and selected client, then retry.";
}

export function describeRuntimeSpawnError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "ENOENT":
      return "Windows could not find the selected OpenAI tunnel client. Select the executable again.";
    case "EACCES":
    case "EPERM":
      return "Windows blocked the selected OpenAI tunnel client. Check file permissions or Windows Security.";
    default:
      return "Windows could not start the OpenAI tunnel client. Check the selected executable and try again.";
  }
}

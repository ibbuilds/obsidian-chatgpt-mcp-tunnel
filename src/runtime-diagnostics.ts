/** Client output is bounded in memory and is never shown or persisted verbatim. */
const MAX_OUTPUT_CHARS = 32_768;
export class RuntimeOutput {
  private tail = "";
  append(chunk: string | Buffer): void {
    const text = typeof chunk === "string" ? chunk.slice(-MAX_OUTPUT_CHARS) : chunk.subarray(-MAX_OUTPUT_CHARS).toString("utf8");
    this.tail = (this.tail + text).slice(-MAX_OUTPUT_CHARS);
  }
  consume(): string { const value = this.tail; this.tail = ""; return value; }
}
export interface RuntimeFailure { message: string; retryable: boolean }
export function classifyRuntimeExit(code: number | null, output: string): RuntimeFailure {
  const log = output.slice(-MAX_OUTPUT_CHARS).toLowerCase();
  const result = (message: string, retryable = false): RuntimeFailure => ({ message, retryable });
  if (/unknown flag|flag provided but not defined|unrecognized option|unknown option|unknown shorthand flag/.test(log)) {
    return result("The selected OpenAI client is incompatible with these launch options. Install the latest official client.");
  }
  if (/tunnel[- _]?id[^\n]{0,60}(invalid|required|missing)|invalid[^\n]{0,60}tunnel[- _]?id/.test(log)) {
    return result("The client rejected the Tunnel ID. Check the complete ID in OpenAI connection details.");
  }
  if (/api[- _]?key[^\n]{0,70}(required|missing|not set)/.test(log)) {
    return result("The client did not receive its runtime API key. Save it again in connection details.");
  }
  // Match HTTP status context, not arbitrary digits inside timestamps, IDs or keys.
  if (/\b(?:http(?:\/\d(?:\.\d)?)?|status(?:\s+code)?)[\s:=]+(?:401|403)\b|\b(?:401 unauthorized|403 forbidden)\b|unauthorized|forbidden|invalid api[- _]?key|authentication failed/.test(log)) {
    return result("The tunnel service rejected the credentials or permissions. Check the runtime API key, Tunnel ID, and Tunnels Read + Use access.");
  }
  if (/cloudflared[^\n]{0,150}(failed|missing|not found|exited|timeout|denied|cannot|could not|error)|(?:failed|missing|cannot|could not)[^\n]{0,90}cloudflared/.test(log)) {
    return result("The bundled cloudflared process failed. Check whether Windows Security blocked it or reinstall the official client.");
  }
  if (/address already in use|listen tcp[^\n]{0,100}bind|only one usage of each socket address|eaddrinuse/.test(log)) {
    return result("The local health port (8766) is occupied. Stop the other tunnel before retrying.");
  }
  if (/x509:|certificate verify failed|certificate[^\n]{0,80}(untrusted|expired)|tls handshake/.test(log)) {
    return result("A TLS certificate could not be verified. Check the system clock, VPN, or HTTPS inspection settings.");
  }
  if (/\b(?:http|status(?:\s+code)?)[\s:=]+429\b|too many requests|rate limit exceeded/.test(log)) {
    return result("The tunnel service is rate-limiting requests. An automatic retry is scheduled.", true);
  }
  if (/connection refused|no such host|network is unreachable|i\/o timeout|context deadline exceeded|no route to host|name resolution/.test(log)) {
    return result("A required service could not be reached. Check your network connection, VPN, firewall, or proxy.", true);
  }
  if (/invalid configuration|failed to parse config|configuration file[^\n]{0,50}(error|invalid)/.test(log)) {
    return result("The client rejected its configuration. Check the selected client and connection details.");
  }
  return result("The OpenAI client exited " + (code === null ? "unexpectedly" : "with code " + code) + ". The cause was not identified. Check the saved key and selected client.", true);
}
export function describeRuntimeExit(code: number | null, output: string): string {
  return classifyRuntimeExit(code, output).message;
}
export function describeRuntimeSpawnError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "ENOENT": return "Windows could not find the selected client. Select tunnel-client.exe again.";
    case "EACCES": case "EPERM": return "Windows blocked the OpenAI client. Check file permissions or Windows Security.";
    default: return "Windows could not start the OpenAI client. Check the selected executable.";
  }
}

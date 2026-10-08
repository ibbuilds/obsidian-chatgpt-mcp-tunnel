# Security

## Trust boundaries

ChatGPT MCP Tunnel manages OpenAI's official outbound client. It does **not** implement an MCP server or read and write vault files. Vault as MCP owns permissions and tools exposed to ChatGPT.

- The MCP server URL is restricted to literal `127.0.0.1` or `[::1]` on an explicitly specified port and the `/mcp` path.
- Official Windows downloads must match the exact release asset name, trusted GitHub origin, published byte count and SHA-256 digest. Both `tunnel-client.exe` and `cloudflared.exe` must be present.
- The installer keeps both files in the same user-local directory and does not run external installers or downloaded shell scripts.
- Secrets are encrypted using Windows Data Protection API for the current logged-in user, outside all Obsidian vaults. Runtime key: `runtime-key.dpapi`; optional Vault as MCP bearer token: `mcp-token.dpapi`.
- Plaintext credentials are not written into Obsidian `data.json`, CLI arguments, repository files or plugin logs. The key and local token are briefly decrypted at client startup and passed through its child environment. The local token is supplied as a static MCP-only `Authorization` header.
- Startup deliberately clears inherited tunnel profile, admin-key, cloudflared token and MCP extra-header settings to prevent unrelated configuration from changing its trusted destination. The runtime uses the official client's normal direct-polling mode; optional managed cloudflared is not enabled by default. Ordinary OS and network proxy variables are preserved.
- The local control panel and health endpoint bind to `127.0.0.1:8766`. It never binds to a public interface.
- ChatGPT MCP Tunnel waits for its owned tunnel-client process to stop before starting a replacement. If the official runtime launches a cloudflared companion, the Windows process-tree shutdown includes it. The plugin never forcibly stops an external tunnel client.

- Child stdout/stderr diagnostics are buffered in memory with a fixed size limit, reduced to predetermined safe explanations, and never exposed verbatim, persisted to the vault, or printed as logs. A native client may still include sensitive details in its own process or diagnostics dashboard.

## Limits

- DPAPI protects secrets **at rest**, but cannot protect against malware or administrators with sufficient access to the active Windows session. Process environment and memory can be inspected by sufficiently privileged software.
- ChatGPT may receive or modify note content through Vault as MCP when authorized. Configure vault paths and MCP write permissions accordingly.
- Creating tunnels, runtime API keys and ChatGPT connections still requires authenticating and consenting in OpenAI Platform/ChatGPT. This plugin does not request or store an OpenAI administrative key.
- One managed tunnel per Windows workstation is supported. If Obsidian terminates abnormally, the child process might remain alive. The next instance detects the occupied health port and does not launch a duplicate.
- The release downloader relies on GitHub-published hashes and legitimate access to the official `openai/tunnel-client` release. It is not a defense against a compromised upstream maintainer or Windows installation.
- Only Windows desktop is supported. The official client's release layout can change; the integration smoke test catches many but not all upstream compatibility breaks. Ordinary CI cannot authenticate against your OpenAI account or prove that ChatGPT can discover your vault tools.
- This tool does not guarantee OpenAI API Platform charges or ChatGPT plan eligibility.

## Reporting vulnerabilities

Do not post runtime keys, Vault as MCP bearer tokens, private notes or tunnel diagnostics containing credentials in public issues. Contact the maintainer privately.

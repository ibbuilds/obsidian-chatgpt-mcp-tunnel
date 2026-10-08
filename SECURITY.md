# Security model

MCP Tunnel is a local management plugin. It does not implement an MCP server, read notes or change vault permissions.

## Scope and trust boundaries

- MCP target is constrained to a literal loopback address and the `/mcp` route. This prevents accidental proxying to remote or attacker-controlled endpoints.
- Official client binaries are downloaded only after an explicit user action from the `openai/tunnel-client` GitHub releases. The chosen archive name, URL, published length and SHA-256 are checked before extraction.
- Runtime secrets are protected using Windows DPAPI in the current user's local application directory, **not inside a synchronized Obsidian vault**.
- No plaintext secret is written into plugin settings, command-line flags, repository files or logs. Startup requires temporary plaintext in process memory and the child process environment.
- The plugin stops only the process it directly started. A manually launched client or unrelated process must be stopped manually.

## Important limits

- DPAPI protects a secret at rest against copying the credential file to another Windows account. It does not protect against malware or administrators operating in the same Windows session.
- The tunnel forwards MCP operations to the local Vault as MCP server. Note content processed by ChatGPT can leave the local machine through that session. Restrict Vault as MCP permissions and review write operations.
- The plugin does not issue, rotate or revoke Platform API keys. Create a restricted Tunnels Read + Use key in OpenAI Platform. Revoke compromised keys there.
- The plugin does not create or grant access to a ChatGPT MCP connection. The ChatGPT connection setup remains a separate one-time authorization.
- A sudden Obsidian crash may leave a child tunnel process running. If you later see an existing runtime warning, inspect and stop the orphaned process before reconnecting.
- Only Windows is supported for now. The client version is updated only when **Install official client** is explicitly chosen.

## Responsible disclosure

For a security issue, contact the repository maintainer privately rather than creating a public issue with credentials or private vault content.

# MCP Tunnel

Minimal Windows-first Obsidian companion plugin for [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp) and the official [OpenAI Tunnel Client](https://github.com/openai/tunnel-client).

**Open Obsidian → local MCP server starts → tunnel starts.** Configure once; use the same tunnel from normal ChatGPT.

## Setup

1. Install **Vault as MCP** and enable **Auto-start server** (default: `http://127.0.0.1:8765/mcp`).
2. Install **MCP Tunnel** in Obsidian and open its native settings.
3. Click **Install official client**, or paste an existing `tunnel-client.exe` path.
4. Copy your Tunnel ID from [Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels).
5. Create a **Restricted** API key with **Tunnels: Read + Use** in [Platform → API keys](https://platform.openai.com/settings/organization/api-keys); paste it once and click **Save key**.
6. Click **Connect**. Register ChatGPT once using the **Tunnel** connection option and that same ID, not the Server URL option.

Leave **Connect automatically** enabled. Subsequent launches need no PowerShell or manual API key entry.

**Existing manual tunnel:** stop an existing `tunnel-client run` window on port 8080 before using automatic startup. This plugin never terminates processes it did not launch.

## Behavior

- Starts asynchronously after Obsidian is ready; waits for Vault as MCP.
- Launches the official client on an ephemeral loopback health port.
- Reports ready only when the client's `/readyz` responds successfully.
- Retries unexpected exits with bounded exponential backoff.
- Stops only its own client on normal Obsidian shutdown.
- Uses native settings and commands, without custom CSS or dashboard UI.

## Security

- Downloaded archives are verified against GitHub's official release size and SHA-256 digest.
- The API key is encrypted with **Windows DPAPI (CurrentUser)** outside your vault, at `%LOCALAPPDATA%\ObsidianMcpTunnel\runtime-key.dpapi`.
- Plaintext API keys are not persisted in the vault, CLI arguments or log output. The key is briefly decrypted and supplied to the child process environment.
- Only literal loopback MCP endpoints are accepted.
- The OpenAI tunnel relays authorized MCP requests and responses, which may contain your note data. DPAPI only protects credentials at rest. This plugin does not guarantee free API Platform billing.

See [SECURITY.md](SECURITY.md).

## Build and install

Requires Node.js 22 or later.

~~~bash
npm install
npm run build
~~~

Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/obsidian-mcp-tunnel/` and reload Obsidian.

`npm test` runs regression tests. `npm run typecheck` performs strict TypeScript checks. CI runs on Windows and Ubuntu, including a Windows-only credential round-trip.

## Architecture

- `src/main.ts`: native settings and Obsidian commands.
- `src/manager.ts`: lifecycle, local health checks and retries.
- `src/installer.ts`: explicit verified binary installation.
- `src/network.ts`: restricted GitHub HTTPS download and local health probes.
- `src/windows.ts`: Windows DPAPI credential storage.
- `src/validation.ts` and `src/release.ts`: testable validation boundaries.

Windows desktop, one managed tunnel, and Vault as MCP are the intentionally narrow scope of version 0.1.0.

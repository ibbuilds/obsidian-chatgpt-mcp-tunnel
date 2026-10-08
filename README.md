# MCP Tunnel

**A minimal Obsidian plugin that connects your local vault to ChatGPT through the official OpenAI Secure MCP Tunnel.**

[Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp) runs the MCP server inside Obsidian. **MCP Tunnel** installs, configures and runs OpenAI's outbound tunnel client. They work side by side: no duplicated server, external app, PowerShell window or separate dashboard.

Windows desktop only. The interface uses Obsidian's native `Setting` components and follows the current theme.

The official client uses **two adjacent executables**: `tunnel-client.exe` manages requests and the OpenAI connection; `cloudflared.exe` provides the encrypted tunnel transport. Both are shipped by OpenAI and launched together. **No separate Cloudflare account or configuration is needed.**

## First-time setup

Install and enable both Obsidian plugins: **Vault as MCP** and **MCP Tunnel**. Enable **Auto-start server** in Vault as MCP.

Then open **Settings → MCP Tunnel**. The first-run setup shows four short steps:

1. **Vault as MCP** — confirms that the plugin is installed and its local MCP endpoint responds. Use **Open plugin** if anything needs attention.
2. **Tunnel client** — click **Install**. MCP Tunnel downloads the correct official OpenAI archive for Windows, validates its SHA-256 digest and size, extracts `tunnel-client.exe` and `cloudflared.exe` together, and installs both. **No command line, archive extraction or manual scripts.**
3. **Tunnel ID** — use **Open tunnels** to create the tunnel on OpenAI Platform and paste its ID into Obsidian.
4. **Runtime API key** — use **Open keys**, create a **Restricted** key with **Tunnels: Read + Use**, paste it once and click **Save**. The key is encrypted by Windows DPAPI outside the vault.

Click **Connect**. When it says **Tunnel ready**, select the **Tunnel** connection option in ChatGPT and use the same Tunnel ID. Registering the connection in ChatGPT is a one-time user-authorized step. **The plugin cannot create a tunnel or API key in your OpenAI account without your authorization.**

Once configured, the setup section collapses behind **Manage**. Normal operation shows only connection status, **Connect / Disconnect**, and **Connect automatically** (on by default).

## Every time Obsidian opens

- Vault as MCP starts its local HTTP MCP server as usual. MCP Tunnel verifies that the local listener identifies itself as Vault as MCP through a read-only MCP `initialize` request.
- MCP Tunnel waits for it and launches the official client in the background.
- The client keeps an outbound HTTPS connection with OpenAI; ChatGPT can send authorized MCP requests to the local server.
- The status changes to **Tunnel ready** only after the official client's `/readyz` responds successfully.
- Unexpected exits cause bounded retries. Obsidian startup is not blocked.
- Closing Obsidian normally stops the full process tree, including the bundled `cloudflared.exe`. **Disconnect** stops automatic retries for the current session.

A fixed local health address (`http://127.0.0.1:8766`) prevents multiple managed instances or an orphaned client from silently creating duplicate tunnels after a crash. A manually started OpenAI client normally uses port 8080. When an existing tunnel is detected, the plugin does not kill or replace it.

**No API key re-entry or PowerShell is needed after setup.**

## Optional: Vault as MCP bearer token

Vault as MCP can optionally protect its local MCP endpoint with a bearer token. If it is enabled, MCP Tunnel detects that authorization is required and exposes **Manage → Advanced → Vault as MCP bearer token**.

Paste the same token you configured in Vault as MCP, then click **Save**. It is encrypted separately from your OpenAI runtime key.

The official tunnel client sends the token only to the configured local MCP endpoint using an `Authorization` header; it is not sent to the OpenAI control-plane API.

## Settings

The default local MCP URL is `http://127.0.0.1:8765/mcp`. Most users never need to change it. **Manage → Advanced** contains the local endpoint, an optional existing executable path, optional bearer token and controls to remove saved secrets.

The command palette also provides **MCP Tunnel: Connect MCP tunnel** and **MCP Tunnel: Disconnect MCP tunnel**.

## Security and scope

- Downloads come exclusively from [official OpenAI releases](https://github.com/openai/tunnel-client/releases/latest). Published SHA-256 digests and byte counts are verified before extraction. Both Windows executables are retained and validated.
- Runtime API key and optional local MCP token are encrypted using Windows **DPAPI CurrentUser**, stored outside the vault in `%LOCALAPPDATA%\ObsidianMcpTunnel\`.
- The decrypted runtime key is passed to the child via environment variables, never written in Obsidian's `data.json`, command-line arguments or repository files.
- The plugin accepts only literal loopback MCP server addresses; it does not read, search, modify or index vault notes itself.
- MCP requests and responses (including selected notes) may pass through the OpenAI tunnel as part of ChatGPT operations. Review Vault as MCP's access-control settings.
- Credentials still require user authorization in OpenAI Platform. API Platform and ChatGPT billing are separate.
- Intended scope: one tunnel per Windows workstation. macOS/Linux, additional servers, account administration and multi-tunnel management are not supported.

More detail: [SECURITY.md](SECURITY.md).

## Installation

Download the two assets from the [latest GitHub release](https://github.com/ibbuilds/obsidian-mcp-tunnel/releases/latest):

- `main.js`
- `manifest.json`

Place both files into `<vault>/.obsidian/plugins/obsidian-mcp-tunnel/`. Reload Obsidian, then enable **MCP Tunnel** under **Settings → Community plugins**.

### From source

Node.js 22+ is required:

~~~sh
npm ci
npm run build
~~~

Install the generated `main.js` and `manifest.json` as above.

### Tests

~~~sh
npm test
npm run typecheck
npm run bundle
~~~

On Windows:

~~~sh
npm run smoke:client
~~~

The smoke test downloads the latest official release, verifies both Windows executables, runs the official `--version` command, and checks repeat installation. The normal CI pipeline runs TypeScript, unit tests and production builds on Windows and Linux. The official-download smoke is available on demand from **GitHub Actions → CI → Run workflow**: select Windows and the manual workflow runs the installer smoke. It is not triggered on every commit because the shared GitHub Actions IP range can hit GitHub's unauthenticated API rate limits.

A real end-to-end test with your own Vault as MCP, OpenAI tunnel ID, runtime API key and ChatGPT account is still needed before removing the preview label.

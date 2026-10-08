# ChatGPT MCP Tunnel

Connect your Obsidian vault to **ChatGPT** using [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp) and OpenAI's official Secure MCP Tunnel. Windows desktop only.

Vault as MCP is the local MCP server that controls note access. ChatGPT MCP Tunnel manages the **outbound** connection to OpenAI. It does not replace Vault as MCP, duplicate its server, or require a PowerShell window after setup.

## Interface

**Native Obsidian UI, designed for this plugin's job.**

- **Status bar:** a small `ChatGPT: Setup / Connecting / Ready / Error` indicator on the far right, after Vault as MCP. Click it to open the connection panel.
- **Right sidebar:** an integrated, docked **ChatGPT MCP Tunnel** panel. The vault and current note stay visible and usable; nothing darkens the background.
- **Connection:** current status and a Connect / Disconnect button. The official client's local diagnostics are available under Advanced when it is running.
- **Configuration:** a short, collapsible set of controls, visible when needed. After first setup it stays out of the way.
- **Settings:** just **Open sidebar** and **Connect automatically**. The connection workflow does not occupy Obsidian's settings page.

The sidebar uses Obsidian's native `ItemView`, `Setting`, buttons, text fields and theme colors. There is no separate web dashboard or modal. A small scoped `styles.css` only adapts the controls to the narrow sidebar.

## First-time connection

1. Install and enable **Vault as MCP** using Obsidian Community plugins. Enable **Auto-start server**. Its default endpoint is `http://127.0.0.1:8765/mcp`.
2. Click the **ChatGPT** status indicator on the bottom right.
3. **OpenAI tunnel client:** choose **Detect** if you already downloaded it, or **Install** to install the current official Windows release automatically. You can also use **Advanced → Browse** to select a client in another folder. The official archive contains both `tunnel-client.exe` and `cloudflared.exe`.
4. **Tunnel ID:** create or find a tunnel using the provided OpenAI Platform link and paste its complete ID.
5. **Runtime API key:** create a restricted OpenAI API key with **Tunnels: Read + Use**, paste it once and click **Save**. The key is encrypted by Windows DPAPI outside the vault.
6. Click **Connect**. When the status says **Ready**, use the **Tunnel** option in ChatGPT MCP connection settings with the same Tunnel ID. **Copy ID** is provided inside the sidebar.

Creating a tunnel, issuing the OpenAI key, and authorizing the ChatGPT connection require user action in OpenAI Platform/ChatGPT. The plugin handles the local setup and background process.

## Using it day to day

Opening Obsidian normally starts Vault as MCP. ChatGPT MCP Tunnel checks the local server's MCP identity and launches the official client when the prerequisites are ready. It waits for the client's real `/readyz` response before reporting **Ready**.

Unexpected exits trigger bounded retries. Closing Obsidian normally stops its managed process tree. The plugin does not terminate a manually started tunnel or launch a duplicate when a managed client is already running.

After configuration, you can leave the sidebar closed. Click the bottom-right ChatGPT indicator whenever you need to check the connection.

### When the executable is already installed

A blank saved client path does **not** mean the client is uninstalled.

The plugin checks its own installation automatically. **Detect** searches a bounded set of common user folders (including Downloads and PATH) and reuses a valid complete client bundle. For files stored elsewhere, choose **Advanced → Browse** or paste the full path and select **Use path**.

External executable files are never silently adopted for automatic execution without your explicit action.

### Optional local MCP authentication

If Vault as MCP requires a bearer token, enter that token under **Configuration → Advanced**. It is encrypted separately from the OpenAI runtime key. This is only needed when bearer authentication is enabled in Vault as MCP.

## Installation or update

### Git clone (Windows Git Bash)

Clone into your vault's `.obsidian/plugins` directory and build:

~~~bash
git clone https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel.git chatgpt-mcp-tunnel
cd chatgpt-mcp-tunnel
npm ci
npm run build
~~~

For an existing clone, run in the `chatgpt-mcp-tunnel` directory:

~~~bash
git remote set-url origin https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel.git
git pull --ff-only origin main
npm ci
npm run build
~~~

Restart or reload the plugin in Obsidian to load the new bundle. Node.js 22 or later is required to build.

### Release ZIP/manual files

Download `main.js`, `manifest.json` and `styles.css` from the [current GitHub release](https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel/releases) and place all three in:

`<vault>/.obsidian/plugins/chatgpt-mcp-tunnel/`

Restart Obsidian and enable **ChatGPT MCP Tunnel** in Community plugins. Do not place the files in the Vault as MCP plugin directory.

### Upgrading from v0.3.0 or older

Version 0.4.0 changed the Obsidian plugin ID from `obsidian-mcp-tunnel` to `chatgpt-mcp-tunnel`. Disable the old plugin, close Obsidian, and rename the plugin directory if you haven't already. **Keep your existing `data.json`**.

Windows encrypted credentials remain under `%LOCALAPPDATA%\ObsidianMcpTunnel` and are reused after an upgrade. Do not enable two versions simultaneously.

## Security and testing

Client downloads come from official [OpenAI releases](https://github.com/openai/tunnel-client/releases/latest), with archive size and published SHA-256 verified. The two executable files remain adjacent. Manually selected files are checked for a complete Windows executable bundle.

Only literal loopback addresses are accepted as local MCP endpoints. Runtime API keys and optional Vault as MCP bearer tokens are encrypted with Windows DPAPI CurrentUser, never saved in the Obsidian vault. The client receives secrets through its child process environment.

ChatGPT may read or change notes only through tools and access rules exposed by Vault as MCP. Review the vault's ACLs and permissions before authorizing a connector. See [SECURITY.md](SECURITY.md).

For developers:

~~~bash
npm ci
npm test
npm run typecheck
npm run bundle
~~~

GitHub Actions tests and bundles on Windows and Linux. The official Windows client download smoke test can be run separately (`npm run smoke:client`) to avoid shared GitHub API rate limits.

**v0.6.0 is a preview.** Tests verify the build and internal behavior; confirm the actual sidebar appearance and ChatGPT-to-vault flow on your Windows Obsidian installation before treating it as stable.

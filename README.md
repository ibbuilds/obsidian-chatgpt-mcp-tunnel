# ChatGPT MCP Tunnel

A minimal Windows desktop plugin that connects Obsidian to ChatGPT through OpenAI's official Secure MCP Tunnel and [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp).

**Vault as MCP** owns your local MCP server and note access. **ChatGPT MCP Tunnel** manages the outbound connection. Both plugins operate independently. There is no second MCP server and no manual PowerShell window.

## Native interface

ChatGPT MCP Tunnel has its own interaction model without copying the Vault as MCP settings page:

- A discreet **ChatGPT connection indicator** in Obsidian's bottom status bar shows Setup, Waiting, Connecting, Ready, Stopped or Error. Click it to open the connection window.
- The **connection window** is a native Obsidian modal with Connect / Disconnect, connection status and optional tunnel details. One-time setup appears only when incomplete or when the user chooses **Configure**.
- The **plugin settings page** holds only the automatic-start preference and an **Open connection** button.
- No custom dashboard, styling framework, ribbon icon, injected CSS or permanent settings clutter. All UI is made from Obsidian's own Modal and Setting components.

You can also open the window from the Command palette: **ChatGPT MCP Tunnel: Open connection**.

## Setup once

1. Enable **Vault as MCP** in Obsidian and its **Auto-start server** option. The default MCP endpoint is `http://127.0.0.1:8765/mcp`.
2. Open **ChatGPT MCP Tunnel** from the status bar and choose **Configure** (first-time setup opens automatically).
3. **Tunnel client:** click **Detect** to locate an existing official Windows installation. If not found, click **Install**: the plugin downloads the official client, verifies SHA-256 and archive size, and installs both `tunnel-client.exe` and `cloudflared.exe` together. No manual ZIP extraction or scripts.
4. **Tunnel ID:** use **Open tunnels** to create or find an existing tunnel in [OpenAI Platform](https://platform.openai.com/settings/organization/tunnels), then paste its ID.
5. **Runtime API key:** use **Open keys** and create a restricted key with **Tunnels: Read + Use**. Paste it once and click **Save**. Windows protects the key with DPAPI outside the vault.
6. Choose **Connect**. Once the status is **Ready**, register an MCP connection in ChatGPT using **Tunnel** and the same Tunnel ID. ChatGPT-side authorization remains a one-time user action.

You cannot bypass the authenticated account steps for issuing API keys or creating tunnels. The plugin provides direct links and handles the local installation, configuration and runtime.

### An existing tunnel client

The plugin checks its own verified installation directory automatically at startup. It can also reuse a manually installed executable:

- Click **Detect** to search common user locations (Downloads, Desktop, Documents and PATH) for a complete official bundle.
- If installed elsewhere, choose **Configure → Advanced → Existing executable**. Use **Browse** to select `tunnel-client.exe` with the Windows file picker, or paste its path and choose **Use path**.
- The client must have the official `cloudflared.exe` alongside it. An unknown executable is not silently adopted for automatic execution without user action.

**No detection is exhaustive.** A client outside known locations is not treated as uninstalled or deleted. The plugin does not modify another copy of the executable.

## Every time Obsidian opens

Vault as MCP starts its local server. ChatGPT MCP Tunnel verifies its identity through a read-only MCP initialization request, then launches the official OpenAI client after the editor is ready.

The client's local `/readyz` endpoint determines whether the status is **Ready**. Unexpected exits trigger bounded retries. The plugin prevents duplicate managed tunnels, respects an already-running manually started tunnel and stops the managed Windows process tree (including cloudflared) on normal shutdown.

After setup, simply opening Obsidian is enough. **Connect automatically** is enabled by default.

## Preferences and security

**Settings → ChatGPT MCP Tunnel** contains only **Open connection** and **Connect automatically**. Everything needed to establish or repair a connection lives in the native connection window.

Optional Vault as MCP bearer authentication is supported through **Configure → Advanced**. Both the runtime API key and optional bearer token are encrypted for the current Windows user in `%LOCALAPPDATA%\ObsidianMcpTunnel`, not in the vault.

The plugin does not read or edit notes itself. When you authorize ChatGPT tools, requests and selected note content may travel through the OpenAI tunnel to Vault as MCP. Configure Vault as MCP's access controls appropriately. No OpenAI API Platform billing or ChatGPT plan eligibility is guaranteed.

See [SECURITY.md](SECURITY.md).

## Installation

Download `main.js` and `manifest.json` from the [releases page](https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel/releases), put them in `<vault>/.obsidian/plugins/chatgpt-mcp-tunnel/`, reload Obsidian and enable **ChatGPT MCP Tunnel** under Community plugins.

To clone directly into your vault's `.obsidian/plugins` folder:

~~~cmd
git clone https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel.git chatgpt-mcp-tunnel
cd chatgpt-mcp-tunnel
npm ci
npm run build
~~~

Node.js 22 or later is required when building from source.

### Upgrade from v0.3.0

Version 0.4.0 changed the plugin ID from `obsidian-mcp-tunnel` to `chatgpt-mcp-tunnel`. If you still use the older folder, **disable the old plugin, close Obsidian**, rename the folder to `chatgpt-mcp-tunnel` and preserve your existing `data.json`. Your DPAPI-protected Windows keys remain in the same user-local directory and are reusable.

To update an existing Git clone inside the correct plugin folder:

~~~cmd
git remote set-url origin https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel.git
git pull --ff-only origin main
npm ci
npm run build
~~~

Restart Obsidian and reload or re-enable the plugin.

## Development

~~~sh
npm ci
npm test
npm run typecheck
npm run bundle
~~~

Windows and Linux CI run strict TypeScript, regression tests and a production bundle. The Windows official-binary download smoke test can be run separately with `npm run smoke:client` when GitHub releases are not rate-limited.

Version 0.5.0 is a **preview**. The actual Windows Obsidian-to-ChatGPT connection should be verified on a user's workstation before declaring a stable release.

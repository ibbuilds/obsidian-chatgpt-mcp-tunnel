# ChatGPT MCP Tunnel

A small status-bar popover for connecting **Obsidian to ChatGPT** through the official OpenAI tunnel client and [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp). Windows desktop only.

## Open, use, dismiss

Click **ChatGPT** at the bottom right. A compact popover opens directly above the indicator. Click outside, press **Esc**, or click the indicator again to close it. Hover only shows a tooltip.

There is **no sidebar, no modal, no dimming and no editor resizing**. The popover uses Obsidian buttons, inputs, icons and theme variables. Keyboard users can open it with Enter or Space; Escape returns focus to the indicator. Clicking the editor does not steal focus back.

## Configure once

The popover shows the first incomplete step rather than an entire settings form:

1. **Local connection.** Check Vault as MCP and find the OpenAI client. Use **Find existing client**, **Choose file**, or **Install client**. An unselected path is not described as an uninstalled program.
2. **OpenAI details.** Enter your existing Tunnel ID and runtime API key. Small links open the correct Platform pages. Use a restricted key with **Tunnels: Read + Use**; click **Save & connect**.
3. **ChatGPT.** Once the local tunnel is ready, open ChatGPT, add an MCP connection with the **Tunnel** option and choose the same ID. Copy is built in. Already added it? Acknowledge it once to skip this screen next time.

The ChatGPT acknowledgement is **your confirmation**, not a remote test of tool discovery. The plugin cannot create keys, grant account permissions or authorize a ChatGPT connector for you.

Vault as MCP still owns the local server, automatic server startup, note access and permissions. This plugin only installs/configures/runs the outbound tunnel client. No second MCP server is created.

## Daily use

After setup, the popover shows **Tunnel ready**, **Connecting**, **Stopped**, or a specific error, with a single main Connect/Disconnect action. Closing the popover does not stop the tunnel.

The settings icon contains **Start with Obsidian**, editing the connection details, selecting another client, optional local MCP authentication, and local diagnostics. Sensitive drafts stay in memory and are cleared on dismissal. Periodic status updates do not rerender active forms or erase typed text.

The persistent plugin settings page only opens the popover and controls automatic startup.

## Existing installations

Keep the same plugin directory, `data.json`, Tunnel ID and saved Windows credentials. **v0.7.0 removes only this plugin's obsolete connection sidebar** on startup; other Obsidian tabs are not closed or resized.

If you downloaded `tunnel-client.exe` earlier, choose that existing file. Keep its bundled `cloudflared.exe` alongside it. No additional Cloudflare account is requested. Searching is bounded to known directories; files elsewhere can be selected explicitly.

### Update from Git Bash

Run inside `.obsidian/plugins/chatgpt-mcp-tunnel` with Obsidian closed:

```bash
git pull --ff-only origin main && npm ci && npm run build
```

Reopen Obsidian and click **ChatGPT** in the status bar. The same command obtains `styles.css`; no folder rename is needed when upgrading from v0.4.0 or newer.

### Fresh install

Download **main.js**, **manifest.json** and **styles.css** from [Releases](https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel/releases) into:

```text
<vault>/.obsidian/plugins/chatgpt-mcp-tunnel/
```

Enable the plugin under Community plugins. To build a clone in that directory:

```bash
git clone https://github.com/ibbuilds/obsidian-chatgpt-mcp-tunnel.git chatgpt-mcp-tunnel
cd chatgpt-mcp-tunnel
npm ci
npm run build
```

Node.js 22+ is only needed when building from source.

### Upgrading from v0.3.0

Disable the previous plugin, close Obsidian and rename the old `obsidian-mcp-tunnel` directory to `chatgpt-mcp-tunnel`. Keep its `data.json`. Windows encrypted credentials remain in `%LOCALAPPDATA%\ObsidianMcpTunnel` and are reused.

## Troubleshooting a failed startup

**The plugin runs tunnel-client.exe for you. Do not start it in PowerShell.** If the client exits with a nonzero code, the plugin captures a bounded amount of stdout/stderr in memory, classifies common failures, and displays a safe, actionable message in the ChatGPT popover. The raw client output is **not** written to Obsidian data, its vault, or the console, and is never shown verbatim because it may contain credentials.

For example, an invalid or unauthorized OpenAI runtime key, an old unsupported executable, a blocked cloudflared.exe, and a busy local health port receive distinct messages. Update the plugin to **v0.7.1**, then click Retry. If the message still only says the cause could not be identified, share the displayed safe error message (not an API key); the remaining cause requires further diagnosis on your Windows machine. Setting the client's working directory to the location of tunnel-client.exe also fixes executable-relative file assumptions in some installations.

## Verification and limits

- Unit tests cover step selection, state copy, small-window positioning, existing-client discovery, MCP identity checks and secret handling.
- `npm run test:browser` runs the production popover code in Chromium with DOM-level Obsidian component doubles. It checks dismissal, no layout shift, focus, form retention, error recovery and normal connection controls. Set `CHROME_PATH` if Chrome is not in a standard location.
- Additional visual checks cover dark/light theme variables and 350–1200 px window widths.
- Windows and Linux CI run the unit tests, TypeScript checks and production build. Linux CI also runs the browser interaction checks.

Browser fixtures are not a live Obsidian installation. Verify your actual theme and end-to-end ChatGPT connection on your PC before treating this preview as stable.

## Security

The official client downloader verifies release size and SHA-256 and preserves both Windows executables. Runtime keys and optional local bearer tokens are protected with Windows DPAPI outside the vault. They are not stored in `data.json`, command-line arguments or plugin logs. The runtime still needs plaintext credentials briefly in its process environment.

Only loopback MCP endpoints are allowed. Note contents requested through ChatGPT may pass through the tunnel; access remains controlled by Vault as MCP. No guarantee is made about OpenAI Platform billing or plan eligibility. See [SECURITY.md](SECURITY.md).

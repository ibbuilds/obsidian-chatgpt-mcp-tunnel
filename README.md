# ChatGPT MCP Tunnel

A guided status-bar popover for connecting **Obsidian to ChatGPT Chat** through the official OpenAI tunnel client and [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp). Windows desktop only. The bridge transports MCP operations; it does not make model-inference API calls.

## Open, use, dismiss

Click **ChatGPT** at the bottom right. A compact popover opens directly above the indicator. Click outside, press **Esc**, or click the indicator again to close it. Hover only shows a tooltip.

There is **no sidebar, no modal, no dimming and no editor resizing**. The popover uses Obsidian buttons, inputs, icons and theme variables. Keyboard users can open it with Enter or Space; Escape returns focus to the indicator. Clicking the editor does not steal focus back.

The status bar shows only **ChatGPT**, immediately before Source Scraper, with readiness in its tooltip. The everyday panel uses the same 360px width, header, native theme and control sizing as Source Scraper: local state, one action and a short navigation row. Once ready, **Abrir ChatGPT** opens ChatGPT directly; **Probar en ChatGPT** opens the registration and read-only test guide. **Opciones** contains startup, connection details, client selection, repair, disconnect and collapsed local MCP/diagnostic controls. Labels are in Spanish. Local readiness never claims that ChatGPT has discovered or successfully used the connector.

## Configure once

The popover shows the first incomplete step rather than an entire settings form:

1. **Local connection.** Choose **Preparar conexión**. The plugin enables an installed Vault as MCP dependency, starts its server, detects its port and optional local token, finds an existing OpenAI client or installs the official bundle, and checks the actual MCP note tools. If Vault as MCP is missing, its install page is linked directly. Manual client selection remains available.
2. **OpenAI details.** The assistant links directly to Platform tunnel settings and runtime keys. Create or reuse a tunnel associated with your intended ChatGPT workspace. Create a restricted runtime key in the same Platform organization with **Tunnels: Read + Use**. Paste the Tunnel ID and key once, then choose **Guardar y conectar**. Account sign-in, key creation, permission grants and consent remain your actions.
3. **ChatGPT.** Open **Plugins → + → Add custom MCP server**, choose **Tunnel**, and select the same ID. For this local bridge choose **No authentication**; local bearer authentication is handled by the tunnel client. Create and install the plugin, open a new **Chat**, select **@Obsidian**, and use **Copiar prueba** to verify reading without modifying notes. If the tunnel is missing, review the linked workspace-association and permission guidance.

The ChatGPT acknowledgement is **your confirmation**, not a remote test of tool discovery. The plugin cannot create keys, grant account permissions or authorize a ChatGPT connector for you.

Vault as MCP owns the local server, note access and permissions. A guarded adapter can enable/start that dependency and read its connection details; it never changes ACLs. Background recovery starts an already-enabled dependency but respects a deliberately disabled plugin. No second MCP server is created.

## Client location and upgrades

The managed executables live next to this plugin's sources and settings:

```text
<plugin-directory>/client/
  <release-version>/<archive-digest>/tunnel-client.exe
  <release-version>/<archive-digest>/cloudflared.exe
  imported/<bundle-digest>/...   # an existing selected installation
```

The `client/` directory is ignored by Git. Existing selected clients and older `%LOCALAPPDATA%\ObsidianMcpTunnel\client` installs are copied into this managed directory on startup. Only the two required executables are imported; original files are retained. The configured path is updated after a successful copy. Downloads still verify the published release size and SHA-256 before extraction.

**Credentials stay outside the vault**, encrypted with Windows DPAPI in `%LOCALAPPDATA%\ObsidianMcpTunnel`. Copying or syncing the plugin does not transfer usable credentials to another Windows account. The client folder can be excluded from vault synchronization and restored through setup when needed.

## Daily use

After setup, the popover shows **Tunnel ready**, **Connecting**, **Stopped**, or a specific error, with a main Connect/Disconnect action. **Start with Obsidian** starts the configured tunnel automatically. A stopped, enabled Vault as MCP server is started when needed. Closing the popover does not stop the tunnel.

Readiness checks both the tunnel and the local MCP server. If the server stops or rejects its token, the UI shows the local problem instead of leaving a misleading ready state. **Repair local connection** re-detects the port/token, checks the note tools, and reconnects when configured. Manual local settings are preserved until you select automatic detection again.

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

Common startup failures—invalid or unauthorized runtime keys, unsupported executables, local health-port conflicts, network failures, and optional cloudflared startup errors—receive distinct messages. Known credential/configuration failures wait for a manual correction instead of retrying continuously; transient connection failures use bounded backoff. If the message still says the cause could not be identified, share the displayed safe message (never your API key or private notes). The client is launched automatically from its executable directory, so no PowerShell window is required.

v0.8.2 fixes the confirmed exit-code-1 startup failure with official client v0.0.16: warning-level logging now explicitly selects its required structured-text format. Logging configuration failures also receive a specific message and stop automatic retries.

## What's improved in v0.8.0

- Polished, theme-native popover across dark/light modes and narrow windows; keyboard navigation, focus, and secret visibility controls are tested in a Chromium UI harness.
- Safer lifecycle: cancelled starts cannot spawn a late client, client replacements wait for shutdown, unexpected exits have explicit retry policies, and health timeouts are monitored.
- Runtime isolation: unrelated shell tunnel profiles, routing, administrative keys, and raw HTTP logging are not inherited. The official client uses its normal **direct-polling** mode rather than enabling optional managed cloudflared by default.
- Connection edits are serialized, and saving unchanged account, local endpoint, or executable values no longer interrupts an already-running tunnel.
- Startup credentials stay encrypted outside the vault. Diagnostic output is bounded in memory, classified into safe messages, and never displayed or persisted verbatim.
- The ChatGPT account settings link remains accessible even when the local tunnel is temporarily offline.

## What's improved in v0.9.0

- One-action local setup, dependency startup, automatic local port/token detection, and a repair action.
- Plugin-local client installation and safe migration of existing executable bundles.
- Guided Platform and ChatGPT setup with direct links, workspace association guidance, plugin installation instructions, and a read-only test prompt.
- Real MCP tool discovery, JSON and SSE response support, session cleanup, absolute deadlines, and truncated-response recovery.
- Local-server health monitoring in addition to OpenAI tunnel readiness.
- Atomic encrypted credential writes and rollback when settings cannot be saved.
- Cancelled preparation and settings saves cannot resurrect a disconnected client; failed saves restore the prior connection where possible.

## Verification and limits

v0.8.1 fixes source-build warnings: the Obsidian development SDK uses patched Moment 2.31.0, npm 12 approves only the pinned esbuild install script, and TypeScript sources have an explicit ES-module scope. The installed `main.js` remains CommonJS for Obsidian. CI also checks dependency audits and a clean Windows build with npm 12.

- Unit tests cover step selection, state copy, positioning, executable migration, dependency startup, MCP identity/tool discovery, JSON/SSE/session behavior, connection cancellation, settings recovery and secret handling.
- `npm run test:browser` runs the production popover code in Chromium with DOM-level Obsidian component doubles. It checks dismissal, no layout shift, focus, form retention, guided setup, error recovery and normal connection controls. Chrome and Windows Edge are discovered in standard locations; set `CHROME_PATH` to override.
- Additional visual checks cover dark/light theme variables and 350–1200 px window widths.
- Windows and Linux CI run the unit tests, TypeScript checks and production build. Linux CI also runs the browser interaction checks.

Browser fixtures and Windows/Linux CI are not a live, authenticated Obsidian-to-ChatGPT connection. Verify the actual tunnel, tool discovery, and note permissions on your Windows computer before treating v0.8.0 as stable.

## Security

The official client downloader verifies release size and SHA-256 and preserves both Windows executables. Runtime keys and optional local bearer tokens are protected with Windows DPAPI outside the vault. They are not stored in `data.json`, command-line arguments or plugin logs. The runtime still needs plaintext credentials briefly in its process environment.

Only loopback MCP endpoints are allowed. Note contents requested through ChatGPT may pass through the tunnel; access remains controlled by Vault as MCP. No guarantee is made about OpenAI Platform billing or plan eligibility. See [SECURITY.md](SECURITY.md).

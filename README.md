# MCP Tunnel

A focused Windows desktop plugin for [Obsidian](https://obsidian.md/) that simplifies the first connection to ChatGPT and automatically runs the official [OpenAI Tunnel Client](https://github.com/openai/tunnel-client) alongside [Vault as MCP](https://github.com/ebullient/obsidian-vault-mcp).

**Configure once. Open Obsidian. ChatGPT can reach your MCP server.**

Vault as MCP provides the local MCP server and starts it automatically. MCP Tunnel manages the **outbound connection to ChatGPT**. It does not create a second server or access the vault's notes directly.

## Setup

Install both **Vault as MCP** and **MCP Tunnel** as Obsidian community plugins (or install MCP Tunnel manually from the release).

Open **Settings → MCP Tunnel**. The native setup section contains only four items:

1. **Vault as MCP** — checks that the other plugin is installed and the local MCP endpoint responds. Click **Open plugin** if it needs setup. Enable **Auto-start server** there.
2. **Tunnel client** — click **Install** to download and verify the official OpenAI client. **No manual ZIP extraction or PowerShell required.**
3. **Tunnel ID** — click **Open tunnels** to create the tunnel in OpenAI Platform; paste its ID.
4. **Runtime API key** — click **Open keys**, create a **Restricted** key with **Tunnels: Read + Use**, paste once, and click **Save**. Windows encrypts the key outside the vault.

Click **Connect**. Once the tunnel is ready, use **Open ChatGPT** to register an MCP connection using the **Tunnel** option and the same Tunnel ID. That final one-time account authorization is performed in ChatGPT, not by this plugin.

The user still creates their own tunnel, API key and ChatGPT connection. These require authenticated OpenAI account permissions; this plugin does not silently request administrator privileges.

Once configured, the setup fields are hidden behind **Manage**. The normal interface contains connection status, Connect/Disconnect and **Connect automatically** (enabled by default).

## Each time Obsidian opens

1. Vault as MCP starts its local server as configured.
2. MCP Tunnel waits for the local server, then starts `tunnel-client.exe` automatically in the background.
3. The client's `/readyz` reports when its connection is ready. Unexpected exits trigger bounded retries.
4. On normal Obsidian shutdown, MCP Tunnel stops only the client that **it** launched.

There is no separate PowerShell window or manual key entry on subsequent launches.

If an older tunnel-client process is still running manually on port 8080, stop it first. MCP Tunnel never terminates external processes.

## Safety and performance

- Official release archives must match GitHub's published **SHA-256 and size**.
- The installer retains **tunnel-client.exe and its bundled cloudflared.exe** together in `%LOCALAPPDATA%\ObsidianMcpTunnel\client\`. Both binaries are necessary for the supported release.
- The runtime key is protected with **Windows DPAPI (CurrentUser)** at `%LOCALAPPDATA%\ObsidianMcpTunnel\runtime-key.dpapi`. It is never saved in the Obsidian vault, command-line arguments or logs.
- Keys are decrypted briefly when starting the child process. DPAPI protects keys at rest, not against a compromised Windows session.
- The MCP endpoint must be on the local loopback interface. Your note data may still transit the OpenAI tunnel when ChatGPT calls Vault as MCP tools.
- The status UI is built only with native Obsidian `Setting` components. No custom CSS, dashboard framework, active polling in the UI or ribbon clutter.
- Other than the 3-second lightweight health check loop, the plugin does no work after startup unless a connection needs attention.

## Advanced

**Manage → Advanced** allows reusing an existing executable or changing the local MCP endpoint. The plugin never installs or modifies Vault as MCP.

## Installation from source

Requires Node.js 22+:

~~~bash
npm install
npm run build
~~~

Install `main.js` and `manifest.json` under `<vault>/.obsidian/plugins/obsidian-mcp-tunnel/`, reload Obsidian, and enable the plugin.

The automated pipeline runs unit tests, strict TypeScript checks, and production builds on Windows and Ubuntu. A real Windows Obsidian/ChatGPT end-to-end check is still needed before a stable release.

See [SECURITY.md](SECURITY.md) for trust boundaries and limitations.

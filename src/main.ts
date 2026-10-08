import { Notice, Plugin, PluginSettingTab, Setting, setIcon, type App } from "obsidian";
import { join } from "node:path";
import { ConnectionPopover } from "./connection-popover";
import { discoverExistingClient } from "./discovery";
import { isCompleteInstallation, validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { inspectVaultAsMcp } from "./prerequisites";
import { probeVaultMcp } from "./mcp-probe";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, normalizeSettings, type TunnelSettings } from "./types";
import { isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { localDataDirectory, WindowsSecretStore } from "./windows";
import type { PopoverHost } from "./popover-host";
import type { SetupFacts } from "./ui-model";

const LEGACY_VIEW_TYPE = "chatgpt-mcp-tunnel-connection";

export default class ChatGptMcpTunnel extends Plugin implements PopoverHost {
  settings: TunnelSettings = { ...DEFAULT_SETTINGS };
  readonly secrets = new WindowsSecretStore();
  manager!: TunnelManager;
  private popover: ConnectionPopover | null = null;
  private statusItem: HTMLElement | null = null;
  private statusLabel: HTMLElement | null = null;
  private actions: Promise<unknown> = Promise.resolve();
  private installPromise: Promise<void> | null = null;
  private detectPromise: Promise<boolean> | null = null;
  private pickers = new Set<() => void>();
  private unloaded = false;

  get snapshot() { return this.manager.snapshot; }
  get installing(): boolean { return this.installPromise !== null; }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.manager = new TunnelManager(() => this.settings, this.secrets, () => this.updateUi());
    this.addSettingTab(new TunnelPreferences(this.app, this));
    this.statusItem = this.addStatusBarItem();
    this.statusItem.addClass("mod-clickable", "cmt-status");
    this.statusItem.setAttribute("role", "button");
    this.statusItem.setAttribute("aria-haspopup", "dialog");
    this.statusItem.setAttribute("aria-expanded", "false");
    this.statusItem.tabIndex = 0;
    setIcon(this.statusItem.createSpan({ cls: "cmt-status-icon" }), "plug-zap");
    this.statusLabel = this.statusItem.createSpan();
    this.registerDomEvent(this.statusItem, "click", () => this.togglePopover());
    this.registerDomEvent(this.statusItem, "keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault(); this.togglePopover();
      }
    });
    this.updateUi();
    this.addCommand({ id: "open-connection", name: "Open connection", callback: () => this.openPopover() });
    this.addCommand({ id: "connect", name: "Connect", callback: () => void this.connect().catch(() => new Notice("Could not connect. Open the ChatGPT indicator for details.")) });
    this.addCommand({ id: "disconnect", name: "Disconnect", callback: () => this.disconnect() });
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE);
      if (this.statusItem?.parentElement) this.statusItem.parentElement.appendChild(this.statusItem);
      void this.restoreManagedClient().finally(() => { if (!this.unloaded) this.manager.begin(); });
    });
  }

  onunload(): void {
    this.unloaded = true;
    for (const cancel of this.pickers) cancel();
    this.popover?.close(false);
    this.manager?.dispose();
  }
  openPopover(): void {
    if (this.unloaded || this.popover?.isOpen || !this.statusItem) return;
    this.popover = new ConnectionPopover(this.statusItem, this, () => { this.popover = null; });
    this.popover.open();
  }
  private togglePopover(): void {
    if (this.popover?.isOpen) this.popover.close(true); else this.openPopover();
  }
  private updateUi(): void {
    if (this.unloaded) return;
    const state = this.snapshot.state;
    const label = state === "connected" ? "Ready" : state === "starting" || state === "connecting" ? "Connecting" : state === "stopping" ? "Stopping" : state === "not-configured" ? "Setup" : state === "error" ? "Error" : state === "existing-runtime" ? "In use" : state === "waiting-for-obsidian" ? "Waiting" : "Off";
    this.statusLabel?.setText(`ChatGPT: ${label}`);
    if (this.statusItem) {
      this.statusItem.dataset.state = state;
      this.statusItem.title = `${this.snapshot.detail}\nClick to manage the connection`;
      this.statusItem.setAttribute("aria-label", `ChatGPT MCP Tunnel: ${label}. Open connection.`);
    }
    this.popover?.updateConnection();
  }

  /** Serialize config/secret mutations. A rejected write must not poison later saves. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.actions.catch(() => undefined).then(async () => {
      if (this.unloaded) throw new Error("The plugin was closed. Reopen Obsidian to continue.");
      return operation();
    });
    this.actions = task;
    return task;
  }
  private async commit(settings: TunnelSettings): Promise<void> {
    if (this.unloaded) throw new Error("The plugin was closed before settings could be saved.");
    // Apply in-memory changes only after the disk write succeeds.
    try { await this.saveData({ ...settings }); }
    catch { throw new Error("Could not save plugin settings. Check that the vault is writable and try again."); }
    this.settings = settings;
    this.updateUi();
  }
  private async replaceClient(path: string): Promise<void> {
    await this.enqueue(async () => {
      await validateClientExecutable(path);
      // Detecting a previously selected executable must not interrupt a healthy tunnel.
      if (path.toLowerCase() === this.settings.clientPath.toLowerCase()) return;
      const resume = this.manager.activeSession;
      await this.manager.disconnect();
      await this.commit({ ...this.settings, clientPath: path });
      if (resume && !this.unloaded) await this.manager.connectNow();
    });
  }
  private async restoreManagedClient(): Promise<void> {
    try {
      const original = this.settings.clientPath;
      const found = await discoverExistingClient(original, [join(localDataDirectory(), "client")]);
      if (found && found !== original) await this.enqueue(async () => {
        // Do not overwrite a file the user selected while discovery was running.
        if (this.settings.clientPath === original) await this.commit({ ...this.settings, clientPath: found });
      });
    } catch { /* First-run UI explains missing settings; do not block the editor. */ }
  }

  async inspect(): Promise<SetupFacts> {
    const config = { ...this.settings };
    const [client, key, token, vault] = await Promise.all([
      isCompleteInstallation(config.clientPath), this.secrets.hasKey(),
      this.secrets.hasMcpToken(), inspectVaultAsMcp(this.app, config.mcpUrl),
    ]);
    let state: SetupFacts["vault"] = vault.authenticationRequired ? "authentication" : vault.endpointResponding ? "running" : vault.installed ? "stopped" : "missing";
    if (state === "authentication" && token) {
      const result = await probeVaultMcp(config.mcpUrl, await this.secrets.readMcpToken());
      if (result === "ready") state = "running";
    }
    return { client, key, token, vault: state };
  }
  async findClient(): Promise<boolean> {
    if (this.detectPromise) return this.detectPromise;
    this.detectPromise = (async () => {
      const found = await discoverExistingClient(this.settings.clientPath);
      if (!found) return false;
      await this.replaceClient(found); return true;
    })();
    try { return await this.detectPromise; } finally { this.detectPromise = null; }
  }
  async installClient(progress: (message: string) => void): Promise<void> {
    if (this.installPromise) return this.installPromise;
    const labels: Record<InstallProgress, string> = {
      metadata: "Checking the official release…", downloading: "Downloading OpenAI's client…",
      verifying: "Verifying the download…", installing: "Installing client files…",
    };
    this.installPromise = (async () => {
      const path = await installOfficialClient((state) => progress(labels[state]));
      await this.replaceClient(path);
    })();
    try { await this.installPromise; } finally { this.installPromise = null; this.updateUi(); }
  }
  async chooseClient(doc: Document): Promise<boolean> {
    if (this.unloaded) return false;
    return new Promise((resolve, reject) => {
      const picker = doc.createElement("input");
      picker.type = "file"; picker.accept = ".exe"; picker.hidden = true;
      let settled = false;
      const finish = (chosen: boolean, error?: unknown): void => {
        if (settled) return;
        settled = true; picker.remove(); this.pickers.delete(cancel);
        if (error) reject(error); else resolve(chosen);
      };
      const cancel = (): void => finish(false);
      this.pickers.add(cancel);
      doc.body.appendChild(picker);
      picker.addEventListener("cancel", cancel, { once: true });
      picker.addEventListener("change", () => {
        void (async () => {
          try {
            const file = picker.files?.[0];
            if (!file) { finish(false); return; }
            const electron = require("electron") as { webUtils?: { getPathForFile?: (file: File) => string } };
            const path = electron.webUtils?.getPathForFile?.(file);
            if (!path) throw new Error("This Obsidian version couldn't read the selected file path.");
            await this.replaceClient(path); finish(true);
          } catch (error) { finish(false, error); }
        })();
      }, { once: true });
      picker.click();
    });
  }
  async saveAccount(tunnelId: string, key: string): Promise<void> {
    if (!isValidTunnelId(tunnelId)) throw new Error("Paste the complete Tunnel ID from OpenAI Platform.");
    await this.enqueue(async () => {
      if (!key.trim() && !(await this.secrets.hasKey())) throw new Error("Add a runtime API key to continue.");
      // Re-saving unchanged details should never disrupt a healthy connection.
      if (!key.trim() && this.settings.tunnelId === tunnelId.trim()) return;
      // Cancel pending preflight as well as an already-running process.
      await this.manager.disconnect();
      if (key.trim()) await this.secrets.saveKey(key.trim());
      await this.commit({ ...this.settings, tunnelId: tunnelId.trim(),
        chatgptLinked: this.settings.tunnelId === tunnelId.trim() && this.settings.chatgptLinked,
      });
    });
  }
  async saveLocal(endpoint: string, token: string): Promise<void> {
    if (!parseLocalMcpEndpoint(endpoint)) throw new Error("Use a local HTTP address such as http://127.0.0.1:8765/mcp.");
    await this.enqueue(async () => {
      // A no-op save must not interrupt the running tunnel.
      if (endpoint.trim() === this.settings.mcpUrl && !token.trim()) return;
      const resume = this.manager.activeSession;
      await this.manager.disconnect();
      if (token.trim()) await this.secrets.saveMcpToken(token.trim());
      await this.commit({ ...this.settings, mcpUrl: endpoint.trim() });
      if (resume && !this.unloaded) await this.manager.connectNow();
    });
  }
  async setAutoConnect(enabled: boolean): Promise<void> {
    await this.enqueue(() => this.commit({ ...this.settings, autoConnect: enabled }));
  }
  async acknowledgeChatgpt(): Promise<void> {
    await this.enqueue(() => this.commit({ ...this.settings, chatgptLinked: true }));
  }
  async connect(): Promise<void> {
    await this.actions.catch(() => undefined);
    if (!this.unloaded) await this.manager.connectNow();
  }
  disconnect(): void { void this.manager.disconnect().catch(() => undefined); }
  async forgetKey(): Promise<void> {
    await this.enqueue(async () => { await this.manager.disconnect(); await this.secrets.forgetKey(); });
  }
  async forgetToken(): Promise<void> {
    await this.enqueue(async () => { await this.manager.disconnect(); await this.secrets.forgetMcpToken(); });
  }
}

class TunnelPreferences extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ChatGptMcpTunnel) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("ChatGPT MCP Tunnel").setHeading();
    new Setting(this.containerEl).setName("Connection").setDesc("Open the popover above the ChatGPT status indicator.")
      .addButton((button) => button.setButtonText("Open connection").onClick(() => this.plugin.openPopover()));
    new Setting(this.containerEl).setName("Start with Obsidian").setDesc("Start the tunnel automatically after setup.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoConnect).onChange(async (enabled) => {
        try { await this.plugin.setAutoConnect(enabled); }
        catch { toggle.setValue(this.plugin.settings.autoConnect); new Notice("Could not save the startup preference."); }
      }));
  }
}

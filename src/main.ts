import { Plugin, PluginSettingTab, Setting, setIcon, type App } from "obsidian";
import { join } from "node:path";
import { ConnectionPopover } from "./connection-popover";
import { discoverExistingClient } from "./discovery";
import { isCompleteInstallation, validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { inspectVaultAsMcp } from "./prerequisites";
import { probeVaultMcp } from "./mcp-probe";
import { probeLocalHttp } from "./network";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, type TunnelSettings } from "./types";
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
  private writeQueue: Promise<void> = Promise.resolve();
  private installPromise: Promise<void> | null = null;
  private detectPromise: Promise<boolean> | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private unloaded = false;

  get snapshot() { return this.manager.snapshot; }
  get installing(): boolean { return this.installPromise !== null; }

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<TunnelSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.manager = new TunnelManager(() => this.settings, this.secrets, () => this.updateUi());
    this.addSettingTab(new TunnelPreferences(this.app, this));

    this.statusItem = this.addStatusBarItem();
    this.statusItem.addClass("mod-clickable", "cmt-status");
    this.statusItem.setAttribute("role", "button");
    this.statusItem.setAttribute("aria-haspopup", "dialog");
    this.statusItem.setAttribute("aria-expanded", "false");
    this.statusItem.tabIndex = 0;
    const icon = this.statusItem.createSpan({ cls: "cmt-status-icon" });
    setIcon(icon, "plug-zap");
    this.statusLabel = this.statusItem.createSpan();
    this.registerDomEvent(this.statusItem, "click", () => this.togglePopover());
    this.registerDomEvent(this.statusItem, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); this.togglePopover();
      }
    });
    this.updateUi();
    this.addCommand({ id: "open-connection", name: "Open connection", callback: () => this.openPopover() });
    this.addCommand({ id: "connect", name: "Connect", callback: () => { void this.connect(); } });
    this.addCommand({ id: "disconnect", name: "Disconnect", callback: () => this.disconnect() });
    this.app.workspace.onLayoutReady(() => {
      // Migrate only this plugin's obsolete sidebar. Never touch other tabs or pane sizes.
      this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE);
      if (this.statusItem?.parentElement) this.statusItem.parentElement.appendChild(this.statusItem);
      void this.restoreManagedClient().finally(() => { if (!this.unloaded) this.manager.begin(); });
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.popover?.close(false);
    this.manager?.dispose();
  }

  openPopover(): void {
    if (this.popover?.isOpen || !this.statusItem) return;
    this.popover = new ConnectionPopover(this.statusItem, this, () => { this.popover = null; });
    this.popover.open();
  }

  private togglePopover(): void {
    if (this.popover?.isOpen) this.popover.close(true);
    else this.openPopover();
  }

  private updateUi(): void {
    const state = this.snapshot.state;
    const label = state === "connected" ? "Ready" : state === "starting" || state === "connecting" ? "Connecting" : state === "not-configured" ? "Setup" : state === "error" ? "Error" : state === "existing-runtime" ? "In use" : state === "waiting-for-obsidian" ? "Waiting" : "Off";
    this.statusLabel?.setText(`ChatGPT: ${label}`);
    if (this.statusItem) {
      this.statusItem.dataset.state = state;
      this.statusItem.title = `${this.snapshot.detail}\nClick to manage the connection`;
      this.statusItem.setAttribute("aria-label", `ChatGPT MCP Tunnel: ${label}. Open connection.`);
    }
    this.popover?.updateConnection();
  }

  /** Never scan arbitrary folders or adopt new external executables at startup. */
  private async restoreManagedClient(): Promise<void> {
    try {
      const found = await discoverExistingClient(this.settings.clientPath, [join(localDataDirectory(), "client")]);
      if (found && found !== this.settings.clientPath && !this.unloaded) {
        this.settings.clientPath = found;
        await this.saveSettings();
      }
    } catch { /* Setup explains missing client configuration; startup remains non-blocking. */ }
  }

  async inspect(): Promise<SetupFacts> {
    const [client, key, token, vault] = await Promise.all([
      isCompleteInstallation(this.settings.clientPath), this.secrets.hasKey(),
      this.secrets.hasMcpToken(), inspectVaultAsMcp(this.app, this.settings.mcpUrl),
    ]);
    let state: SetupFacts["vault"] = !vault.installed ? "missing" : vault.authenticationRequired ? "authentication" : vault.endpointResponding ? "running" : "stopped";
    if (state === "authentication" && token) {
      const result = await probeVaultMcp(this.settings.mcpUrl, await this.secrets.readMcpToken());
      if (result === "ready") state = "running";
    }
    return { client, key, token, vault: state };
  }

  async findClient(): Promise<boolean> {
    if (this.detectPromise) return this.detectPromise;
    this.detectPromise = (async () => {
      const found = await discoverExistingClient(this.settings.clientPath);
      if (!found) return false;
      this.settings.clientPath = found;
      await this.saveSettings();
      return true;
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
      this.settings.clientPath = path;
      await this.saveSettings();
    })();
    try { await this.installPromise; } finally { this.installPromise = null; this.updateUi(); }
  }

  async chooseClient(doc: Document): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const picker = doc.createElement("input");
      picker.type = "file"; picker.accept = ".exe"; picker.hidden = true;
      doc.body.appendChild(picker);
      picker.addEventListener("cancel", () => { picker.remove(); resolve(false); }, { once: true });
      picker.addEventListener("change", () => {
        void (async () => {
          try {
            const file = picker.files?.[0];
            if (!file) { resolve(false); return; }
            const electron = require("electron") as { webUtils?: { getPathForFile?: (file: File) => string } };
            const path = electron.webUtils?.getPathForFile?.(file);
            if (!path) throw new Error("This Obsidian version couldn't read the selected file path.");
            await validateClientExecutable(path);
            if (this.snapshot.managed) { this.disconnect(); await this.stopping; }
            this.settings.clientPath = path;
            await this.saveSettings();
            resolve(true);
          } catch (error) { reject(error); } finally { picker.remove(); }
        })();
      }, { once: true });
      picker.click();
    });
  }

  async saveAccount(tunnelId: string, key: string): Promise<void> {
    if (!isValidTunnelId(tunnelId)) throw new Error("Paste the complete Tunnel ID from OpenAI Platform.");
    if (!key.trim() && !(await this.secrets.hasKey())) throw new Error("Add a runtime API key to continue.");
    if (key.trim()) await this.secrets.saveKey(key.trim());
    if (this.snapshot.managed) { this.disconnect(); await this.stopping; }
    if (this.settings.tunnelId !== tunnelId.trim()) this.settings.chatgptLinked = false;
    this.settings.tunnelId = tunnelId.trim();
    await this.saveSettings();
  }

  async saveLocal(endpoint: string, token: string): Promise<void> {
    if (!parseLocalMcpEndpoint(endpoint)) throw new Error("Use a local HTTP address such as http://127.0.0.1:8765/mcp.");
    const wasRunning = this.snapshot.managed;
    if (wasRunning) { this.disconnect(); await this.stopping; }
    if (token.trim()) await this.secrets.saveMcpToken(token.trim());
    this.settings.mcpUrl = endpoint.trim();
    await this.saveSettings();
    if (wasRunning) await this.connect();
  }

  async setAutoConnect(enabled: boolean): Promise<void> {
    this.settings.autoConnect = enabled;
    await this.saveSettings(); this.updateUi();
  }

  async acknowledgeChatgpt(): Promise<void> {
    // User acknowledgement only. No claim to remotely verify tool discovery.
    this.settings.chatgptLinked = true;
    await this.saveSettings();
  }

  async connect(): Promise<void> {
    await this.stopping;
    if (!this.unloaded) await this.manager.connectNow();
  }

  disconnect(): void {
    const owned = this.snapshot.managed;
    this.manager.disconnect();
    if (owned) {
      // taskkill is asynchronous. Avoid calling a dying owned process "external" on restart.
      this.stopping = (async () => {
        for (let attempt = 0; attempt < 25; attempt++) {
          if (await probeLocalHttp(new URL("http://127.0.0.1:8766/healthz"), 150) === null) return;
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      })();
    }
  }

  async forgetKey(): Promise<void> {
    this.disconnect();
    await this.secrets.forgetKey();
  }

  async forgetToken(): Promise<void> {
    this.disconnect();
    await this.secrets.forgetMcpToken();
  }

  async saveSettings(): Promise<void> {
    // Capture non-secret data at invocation time; writes cannot finish out of order.
    const snapshot = { ...this.settings };
    const next = this.writeQueue.catch(() => undefined).then(() => this.saveData(snapshot));
    this.writeQueue = next;
    await next;
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
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoConnect).onChange((enabled) => this.plugin.setAutoConnect(enabled)));
  }
}

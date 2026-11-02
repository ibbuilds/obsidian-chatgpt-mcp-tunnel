import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { join } from "node:path";
import { keepClientNearPlugin, managedClientRoot } from "./client-storage";
import { ConnectionPopover } from "./connection-popover";
import { discoverExistingClient } from "./discovery";
import { isCompleteInstallation, validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { isVaultAsMcpInstalled, startVaultServer, vaultConnectionDetails } from "./prerequisites";
import { inspectVaultMcp } from "./mcp-probe";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, normalizeSettings, type TunnelSettings } from "./types";
import { isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { localDataDirectory, WindowsSecretStore } from "./windows";
import type { PopoverHost } from "./popover-host";
import { statusCopy, type SetupFacts } from "./ui-model";

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
  private connectionRequest = 0;

  get snapshot() { return this.manager.snapshot; }
  get installing(): boolean { return this.installPromise !== null; }
  private get clientRoot(): string {
    const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & { getBasePath?(): string };
    const base = adapter.getBasePath?.();
    if (!base) throw new Error("Client installation requires a local filesystem vault.");
    return managedClientRoot(join(base, this.manifest.dir || this.app.vault.configDir + "/plugins/" + this.manifest.id));
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.manager = new TunnelManager(() => this.settings, this.secrets, () => this.updateUi(), {
      ensureLocalServer: () => startVaultServer(this.app),
    });
    this.addSettingTab(new TunnelPreferences(this.app, this));
    this.statusItem = this.addStatusBarItem();
    this.statusItem.addClass("mod-clickable", "cmt-status");
    this.statusItem.setAttribute("role", "button");
    this.statusItem.setAttribute("aria-haspopup", "dialog");
    this.statusItem.setAttribute("aria-expanded", "false");
    this.statusItem.tabIndex = 0;
    this.statusLabel = this.statusItem.createSpan({ text: "ChatGPT" });
    this.registerDomEvent(this.statusItem, "click", () => this.togglePopover());
    this.registerDomEvent(this.statusItem, "keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault(); this.togglePopover();
      }
    });
    this.updateUi();
    this.addCommand({ id: "open-connection", name: "Abrir conexión", callback: () => this.openPopover() });
    this.addCommand({ id: "connect", name: "Conectar", callback: () => void this.connect().catch(() => new Notice("No se pudo conectar. Revisa el panel de ChatGPT.")) });
    this.addCommand({ id: "disconnect", name: "Desconectar", callback: () => this.disconnect() });
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE);
      if (this.statusItem?.parentElement) this.statusItem.parentElement.appendChild(this.statusItem);
      void (async () => {
        await this.restoreManagedClient();
        if (this.settings.autoConnect && !this.unloaded) {
          try { await this.prepareVault(false); }
          catch { /* Preflight and setup surface unavailable credentials/server state. */ }
        }
        if (!this.unloaded) this.manager.begin();
      })();
    });
  }

  onunload(): void {
    this.unloaded = true;
    ++this.connectionRequest;
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
    const label = statusCopy(this.snapshot).title;
    if (this.statusLabel?.textContent !== "ChatGPT") this.statusLabel?.setText("ChatGPT");
    if (this.statusItem) {
      if (this.statusItem.dataset.state !== state) this.statusItem.dataset.state = state;
      const description = `ChatGPT. ${label}. Abrir conexión.`;
      if (this.statusItem.title !== description) this.statusItem.title = description;
      if (this.statusItem.getAttribute("aria-label") !== description) this.statusItem.setAttribute("aria-label", description);
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
    const managed = await keepClientNearPlugin(path, this.clientRoot);
    await this.enqueue(async () => {
      await validateClientExecutable(managed);
      // Detecting a previously selected executable must not interrupt a healthy tunnel.
      if (managed.toLowerCase() === this.settings.clientPath.toLowerCase()) return;
      const resume = this.manager.activeSession;
      const request = this.connectionRequest;
      await this.manager.disconnect();
      try { await this.commit({ ...this.settings, clientPath: managed }); }
      finally { if (resume && !this.unloaded && request === this.connectionRequest) await this.manager.connectNow(); }
    });
  }
  private async restoreManagedClient(): Promise<void> {
    try {
      const original = this.settings.clientPath;
      const found = await discoverExistingClient(original, [this.clientRoot, join(localDataDirectory(), "client")]);
      const managed = found ? await keepClientNearPlugin(found, this.clientRoot) : null;
      if (managed && managed !== original) await this.enqueue(async () => {
        // Do not overwrite a file the user selected while discovery was running.
        if (this.settings.clientPath === original) await this.commit({ ...this.settings, clientPath: managed });
      });
    } catch { /* First-run UI explains missing settings; do not block the editor. */ }
  }

  async inspect(): Promise<SetupFacts> {
    const config = { ...this.settings };
    const [client, key, token, installed] = await Promise.all([
      isCompleteInstallation(config.clientPath), this.secrets.hasKey(),
      this.secrets.hasMcpToken(), isVaultAsMcpInstalled(this.app),
    ]);
    const result = await inspectVaultMcp(config.mcpUrl, token ? await this.secrets.readMcpToken() : undefined);
    const state: SetupFacts["vault"] = result.state === "ready" ? "running" : result.state === "authentication-required" ? "authentication"
      : result.state === "missing-tools" || result.state === "unexpected-server" ? result.state : installed ? "stopped" : "missing";
    return { client, key, token, vault: state, toolCount: result.toolCount, writable: result.writable };
  }

  private async prepareVault(explicit: boolean): Promise<void> {
    await startVaultServer(this.app, explicit);
    if (!this.settings.autoDetectLocal) return;
    const details = vaultConnectionDetails(this.app);
    if (!details) return;
    await this.enqueue(async () => {
      if (!this.settings.autoDetectLocal) return;
      const hasToken = await this.secrets.hasMcpToken();
      const oldToken = hasToken ? await this.secrets.readMcpToken() : "";
      if (this.settings.mcpUrl === details.endpoint && oldToken === details.token) return;
      const resume = this.manager.activeSession;
      const request = this.connectionRequest;
      await this.manager.disconnect();
      try {
        const commit = () => this.commit({ ...this.settings, mcpUrl: details.endpoint });
        if (details.token) await this.secrets.saveMcpTokenAndCommit(details.token, commit);
        else { await commit(); await this.secrets.forgetMcpToken(); }
      } finally { if (resume && !this.unloaded && request === this.connectionRequest) await this.manager.connectNow(); }
    });
  }

  async prepareLocal(progress: (message: string) => void): Promise<void> {
    progress("Starting Vault as MCP and detecting its connection…");
    await this.prepareVault(true);
    progress("Finding the OpenAI client…");
    if (!(await this.findClient())) await this.installClient(progress);
    progress("Checking the MCP note tools…");
    const facts = await this.inspect();
    if (facts.vault !== "running") throw new Error(facts.vault === "authentication"
      ? "The local server needs its bearer token. Add it in Local MCP settings."
      : facts.vault === "missing-tools" ? "Vault as MCP is missing its note tools. Update or restart it, then check again."
      : "The local server could not be verified. Open Vault as MCP to check its server settings.");
    if (facts.key && isValidTunnelId(this.settings.tunnelId)) await this.connect();
  }

  async useAutomaticLocal(): Promise<void> {
    await this.enqueue(() => this.commit({ ...this.settings, autoDetectLocal: true }));
    await this.prepareVault(true);
  }
  async findClient(): Promise<boolean> {
    if (this.detectPromise) return this.detectPromise;
    this.detectPromise = (async () => {
      const managed = await discoverExistingClient(this.settings.clientPath, [this.clientRoot]);
      const found = managed ?? await discoverExistingClient();
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
      const path = await installOfficialClient((state) => progress(labels[state]), this.clientRoot);
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
      const resume = this.manager.activeSession;
      const request = this.connectionRequest;
      await this.manager.disconnect();
      const commit = () => this.commit({ ...this.settings, tunnelId: tunnelId.trim(),
        chatgptLinked: this.settings.tunnelId === tunnelId.trim() && this.settings.chatgptLinked,
      });
      try {
        if (key.trim()) await this.secrets.saveKeyAndCommit(key.trim(), commit);
        else await commit();
      } finally { if (resume && !this.unloaded && request === this.connectionRequest) await this.manager.connectNow(); }
    });
  }
  async saveLocal(endpoint: string, token: string): Promise<void> {
    if (!parseLocalMcpEndpoint(endpoint)) throw new Error("Use a local HTTP address such as http://127.0.0.1:8765/mcp.");
    await this.enqueue(async () => {
      // A no-op save must not interrupt the running tunnel.
      if (endpoint.trim() === this.settings.mcpUrl && !token.trim()) {
        if (this.settings.autoDetectLocal) await this.commit({ ...this.settings, autoDetectLocal: false });
        return;
      }
      const resume = this.manager.activeSession;
      const request = this.connectionRequest;
      await this.manager.disconnect();
      try {
        const commit = () => this.commit({ ...this.settings, mcpUrl: endpoint.trim(), autoDetectLocal: false });
        if (token.trim()) await this.secrets.saveMcpTokenAndCommit(token.trim(), commit);
        else await commit();
      } finally { if (resume && !this.unloaded && request === this.connectionRequest) await this.manager.connectNow(); }
    });
  }
  async setAutoConnect(enabled: boolean): Promise<void> {
    await this.enqueue(() => this.commit({ ...this.settings, autoConnect: enabled }));
  }
  async acknowledgeChatgpt(): Promise<void> {
    await this.enqueue(() => this.commit({ ...this.settings, chatgptLinked: true }));
  }
  async connect(): Promise<void> {
    const request = ++this.connectionRequest;
    await this.actions.catch(() => undefined);
    if (this.unloaded || request !== this.connectionRequest) return;
    await this.prepareVault(false);
    if (!this.unloaded && request === this.connectionRequest) await this.manager.connectNow();
  }
  disconnect(): void { ++this.connectionRequest; void this.manager.disconnect().catch(() => undefined); }
  async forgetKey(): Promise<void> {
    await this.enqueue(async () => { await this.manager.disconnect(); await this.secrets.forgetKey(); });
  }
  async forgetToken(): Promise<void> {
    await this.enqueue(async () => {
      await this.manager.disconnect();
      await this.commit({ ...this.settings, autoDetectLocal: false });
      await this.secrets.forgetMcpToken();
    });
  }
}

class TunnelPreferences extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ChatGptMcpTunnel) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("ChatGPT MCP Tunnel").setHeading();
    new Setting(this.containerEl).setName("Conexión").setDesc("Abre el panel de ChatGPT en la barra de estado.")
      .addButton((button) => button.setButtonText("Abrir conexión").onClick(() => this.plugin.openPopover()));
    new Setting(this.containerEl).setName("Iniciar con Obsidian").setDesc("Conecta el túnel automáticamente después de configurarlo.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoConnect).onChange(async (enabled) => {
        try { await this.plugin.setAutoConnect(enabled); }
        catch { toggle.setValue(this.plugin.settings.autoConnect); new Notice("No se pudo guardar esta preferencia."); }
      }));
  }
}

import {
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  type App,
} from "obsidian";
import { join, sep } from "node:path";
import { ConnectionModal } from "./connection-modal";
import { discoverExistingClient } from "./discovery";
import { localDataDirectory } from "./windows";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, type ConnectionState, type TunnelSettings } from "./types";
import { WindowsSecretStore } from "./windows";

function stateLabel(state: ConnectionState): string {
  switch (state) {
    case "connected": return "Ready";
    case "connecting":
    case "starting": return "Connecting";
    case "waiting-for-obsidian": return "Waiting";
    case "existing-runtime": return "External client";
    case "not-configured": return "Setup";
    case "error": return "Error";
    case "stopped": return "Stopped";
  }
}

/** Connection manager, not a second MCP server. Vault as MCP owns the server. */
export default class ChatGptMcpTunnel extends Plugin {
  settings: TunnelSettings = { ...DEFAULT_SETTINGS };
  readonly secrets = new WindowsSecretStore();
  manager!: TunnelManager;

  private connectionModal: ConnectionModal | null = null;
  private statusItem: HTMLElement | null = null;
  private detectionPromise: Promise<string | null> | null = null;
  private detectionAttempted = false;
  private detectionResult: string | null = null;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TunnelSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };

    this.manager = new TunnelManager(
      () => this.settings,
      this.secrets,
      () => this.updateConnectionUi(),
    );

    this.addSettingTab(new TunnelSettingsTab(this.app, this));
    this.statusItem = this.addStatusBarItem();
    this.statusItem.addClass("mod-clickable");
    this.statusItem.setAttribute("role", "button");
    this.statusItem.tabIndex = 0;

    this.registerDomEvent(this.statusItem, "click", () => this.openConnectionModal());
    this.registerDomEvent(this.statusItem, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.openConnectionModal();
      }
    });
    this.updateConnectionUi();

    this.addCommand({
      id: "open-connection",
      name: "Open connection",
      callback: () => this.openConnectionModal(),
    });
    this.addCommand({
      id: "connect",
      name: "Connect",
      callback: () => void this.manager.connectNow(),
    });
    this.addCommand({
      id: "disconnect",
      name: "Disconnect",
      callback: () => this.manager.disconnect(),
    });

    // Never block Obsidian startup while looking for a previously extracted
    // official client. The MCP server itself is owned by Vault as MCP.
    this.app.workspace.onLayoutReady(() => {
      void this.ensureClientDetected()
        .catch(() => undefined)
        .finally(() => this.manager.begin());
    });
  }

  onunload(): void {
    this.connectionModal?.close();
    this.manager?.dispose();
  }

  private updateConnectionUi(): void {
    const snapshot = this.manager.snapshot;
    if (this.statusItem) {
      this.statusItem.empty();
      setIcon(this.statusItem, snapshot.state === "connected" ? "plug-zap" : "plug");
      this.statusItem.createSpan({ text: " ChatGPT: " + stateLabel(snapshot.state) });
      this.statusItem.setAttribute(
        "aria-label",
        "ChatGPT MCP Tunnel: " + snapshot.detail + ". Open connection.",
      );
      this.statusItem.title = snapshot.detail;
    }
    this.connectionModal?.updateConnection();
  }

  openConnectionModal(): void {
    if (this.connectionModal) return;
    this.connectionModal = new ConnectionModal(this);
    this.connectionModal.open();
  }

  onConnectionModalClosed(modal: ConnectionModal): void {
    if (this.connectionModal === modal) this.connectionModal = null;
  }

  /**
   * Reuse an existing complete official installation when it can be found.
   * A missing saved path does not imply that the executable isn't installed.
   */
  async ensureClientDetected(force = false): Promise<string | null> {
    if (this.detectionPromise) return this.detectionPromise;
    if (this.detectionAttempted && !force) {
      return this.detectionResult;
    }
    this.detectionAttempted = true;
    this.detectionPromise = (async () => {
      const trustedRoot = join(localDataDirectory(), "client");
      // On startup only auto-adopt binaries previously installed by this
      // plugin. Files discovered in Downloads/PATH require a user click on
      // Detect before they're configured to run automatically.
      const found = await discoverExistingClient(
        this.settings.clientPath,
        force ? undefined : [trustedRoot],
      );
      this.detectionResult = found;
      const insideManagedRoot = found !== null &&
        found.toLowerCase().startsWith((trustedRoot + sep).toLowerCase());
      if (found && found !== this.settings.clientPath && (force || insideManagedRoot)) {
        this.settings.clientPath = found;
        await this.saveSettings();
      }
      return found;
    })();
    try {
      return await this.detectionPromise;
    } finally {
      this.detectionPromise = null;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** Persistent preferences only; connection/setup live in the native modal. */
class TunnelSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ChatGptMcpTunnel) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("ChatGPT MCP Tunnel")
      .setHeading();

    new Setting(this.containerEl)
      .setName("Connection")
      .setDesc("Manage the tunnel and its one-time setup.")
      .addButton((button) =>
        button.setButtonText("Open connection").onClick(() => this.plugin.openConnectionModal()),
      );

    new Setting(this.containerEl)
      .setName("Connect automatically")
      .setDesc("Start the tunnel when Obsidian opens and Vault as MCP is available.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoConnect).onChange(async (value) => {
          this.plugin.settings.autoConnect = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.manager.connectNow();
        }),
      );
  }
}

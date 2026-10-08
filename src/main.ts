import {
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import { join, sep } from "node:path";
import { CONNECTION_VIEW_TYPE, ConnectionView } from "./connection-view";
import { discoverExistingClient } from "./discovery";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, type ConnectionState, type TunnelSettings } from "./types";
import { localDataDirectory, WindowsSecretStore } from "./windows";

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

/** Manage a ChatGPT tunnel without duplicating Vault as MCP's server. */
export default class ChatGptMcpTunnel extends Plugin {
  settings: TunnelSettings = { ...DEFAULT_SETTINGS };
  readonly secrets = new WindowsSecretStore();
  manager!: TunnelManager;

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

    this.registerView(
      CONNECTION_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ConnectionView(leaf, this),
    );
    this.addSettingTab(new TunnelSettingsTab(this.app, this));

    this.statusItem = this.addStatusBarItem();
    this.statusItem.addClass("mod-clickable");
    this.statusItem.setAttribute("role", "button");
    this.statusItem.tabIndex = 0;
    this.registerDomEvent(this.statusItem, "click", () => void this.openConnectionView());
    this.registerDomEvent(this.statusItem, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.openConnectionView();
      }
    });
    this.updateConnectionUi();

    this.addCommand({
      id: "open-connection",
      name: "Open connection",
      callback: () => void this.openConnectionView(),
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

    // Open after Obsidian's layout is available, with Vault as MCP free to
    // start its own local server. Discovery is bounded and non-blocking to UI.
    this.app.workspace.onLayoutReady(() => {
      this.keepStatusLast();
      void this.ensureClientDetected()
        .catch(() => undefined)
        .finally(() => this.manager.begin());
    });
  }

  onunload(): void {
    this.manager?.dispose();
    this.app.workspace.detachLeavesOfType(CONNECTION_VIEW_TYPE);
  }

  private updateConnectionUi(): void {
    const snapshot = this.manager.snapshot;
    if (this.statusItem) {
      this.statusItem.empty();
      setIcon(
        this.statusItem,
        snapshot.state === "connected" ? "plug-zap" : "plug",
      );
      this.statusItem.createSpan({ text: " ChatGPT: " + stateLabel(snapshot.state) });
      this.statusItem.setAttribute(
        "aria-label",
        "ChatGPT MCP Tunnel: " + snapshot.detail + ". Open sidebar.",
      );
      this.statusItem.title = snapshot.detail;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(CONNECTION_VIEW_TYPE)) {
      if (leaf.view instanceof ConnectionView) leaf.view.updateConnection();
    }
  }

  /**
   * Status items are appended when each plugin loads. Ensure our tunnel's
   * indicator stays after Vault as MCP and other items, including plugins
   * enabled after ours. One MutationObserver, no timers or layout hacks.
   */
  private keepStatusLast(): void {
    const item = this.statusItem;
    const parent = item?.parentElement;
    if (!item || !parent) return;
    const placeLast = (): void => {
      if (item.parentElement === parent && parent.lastElementChild !== item) {
        parent.appendChild(item);
      }
    };
    placeLast();
    const observer = new MutationObserver(placeLast);
    observer.observe(parent, { childList: true });
    this.register(() => observer.disconnect());
  }

  async openConnectionView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(CONNECTION_VIEW_TYPE)[0];
    if (!leaf) {
      // true creates a dedicated right-sidebar leaf rather than replacing
      // whatever other plugins/users are already showing on the right.
      leaf = this.app.workspace.getRightLeaf(true) ?? undefined;
      if (!leaf) return;
      await leaf.setViewState({ type: CONNECTION_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Auto-detect only our own managed installation on startup. A manual
   * Detect action is required before adopting executables in other folders.
   */
  async ensureClientDetected(force = false): Promise<string | null> {
    if (this.detectionPromise) {
      const ongoing = await this.detectionPromise;
      if (!force || ongoing) return ongoing;
    }
    if (this.detectionAttempted && !force) return this.detectionResult;

    this.detectionAttempted = true;
    this.detectionPromise = (async () => {
      const managedRoot = join(localDataDirectory(), "client");
      const found = await discoverExistingClient(
        this.settings.clientPath,
        force ? undefined : [managedRoot],
      );
      this.detectionResult = found;
      const managed =
        found !== null &&
        found.toLowerCase().startsWith((managedRoot + sep).toLowerCase());
      if (found && found !== this.settings.clientPath && (force || managed)) {
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

/** Persistent preferences only. All connection interactions use the sidebar. */
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
      .setDesc("View status, configure the client and connect to ChatGPT.")
      .addButton((button) =>
        button
          .setButtonText("Open sidebar")
          .onClick(() => void this.plugin.openConnectionView()),
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

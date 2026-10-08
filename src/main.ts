import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type ButtonComponent,
  type TextComponent,
} from "obsidian";
import { installOfficialClient, type InstallProgress } from "./installer";
import { TunnelManager } from "./manager";
import { DEFAULT_SETTINGS, type TunnelSettings } from "./types";
import { isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { WindowsSecretStore } from "./windows";

const URL_TUNNELS = "https://platform.openai.com/settings/organization/tunnels";
const URL_API_KEYS = "https://platform.openai.com/settings/organization/api-keys";
const URL_VAULT_MCP = "obsidian://show-plugin?id=vault-as-mcp";

function notifyFailure(error: unknown): void {
  new Notice(error instanceof Error ? error.message : "Operation failed");
}

/** Thin Obsidian integration. Tunnel runtime, release installer and secrets stay isolated. */
export default class ObsidianMcpTunnel extends Plugin {
  settings: TunnelSettings = { ...DEFAULT_SETTINGS };
  readonly secrets = new WindowsSecretStore();
  manager!: TunnelManager;
  private settingsTab!: TunnelSettingsTab;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TunnelSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };

    this.manager = new TunnelManager(
      () => this.settings,
      this.secrets,
      () => this.settingsTab?.updateConnection(),
    );
    this.settingsTab = new TunnelSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({
      id: "connect",
      name: "Connect MCP tunnel",
      callback: () => void this.manager.connectNow(),
    });
    this.addCommand({
      id: "disconnect",
      name: "Disconnect MCP tunnel",
      callback: () => this.manager.disconnect(),
    });

    // Start when Obsidian has finished loading; never block the editor.
    this.app.workspace.onLayoutReady(() => this.manager.begin());
  }

  onunload(): void {
    this.manager?.dispose();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class TunnelSettingsTab extends PluginSettingTab {
  private connectionRow: Setting | null = null;
  private connectButton: ButtonComponent | null = null;
  private dashboardButton: ButtonComponent | null = null;
  private credentialRow: Setting | null = null;
  private credentialInput: TextComponent | null = null;
  private clientPathInput: TextComponent | null = null;

  constructor(app: App, private readonly plugin: ObsidianMcpTunnel) {
    super(app, plugin);
  }

  display(): void {
    const root = this.containerEl;
    root.empty();

    new Setting(root).setName("MCP Tunnel").setHeading();
    root.createEl("p", {
      text: "Connect ChatGPT to Vault as MCP. Configure once; connect automatically whenever Obsidian opens.",
      cls: "setting-item-description",
    });

    this.connectionRow = new Setting(root).setName("Connection");
    this.connectionRow.addButton((button) => {
      this.connectButton = button;
      button.setButtonText("Connect").onClick(async () => {
        try {
          if (this.plugin.manager.snapshot.managed) this.plugin.manager.disconnect();
          else await this.plugin.manager.connectNow();
        } catch (error) {
          notifyFailure(error);
        }
      });
    });
    this.connectionRow.addButton((button) => {
      this.dashboardButton = button;
      button.setButtonText("Status").onClick(() => {
        const url = this.plugin.manager.snapshot.dashboardUrl;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      });
    });
    this.updateConnection();

    new Setting(root)
      .setName("Connect automatically")
      .setDesc("Start when Obsidian opens and Vault as MCP is available.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoConnect).onChange(async (value) => {
          this.plugin.settings.autoConnect = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.manager.connectNow();
        }),
      );

    new Setting(root).setName("Setup").setHeading();

    new Setting(root)
      .setName("Vault as MCP")
      .setDesc("Requires the local Vault as MCP community plugin.")
      .addButton((button) =>
        button.setButtonText("Open plugin").onClick(() => window.open(URL_VAULT_MCP, "_blank")),
      );

    const clientRow = new Setting(root)
      .setName("Tunnel client")
      .setDesc(this.plugin.settings.clientPath || "Not installed. Downloads from official OpenAI releases.");
    clientRow.addButton((button) => {
      button.setButtonText("Install official client").onClick(async () => {
        button.setDisabled(true);
        const labels: Record<InstallProgress, string> = {
          metadata: "Checking release…",
          downloading: "Downloading…",
          verifying: "Verifying…",
          installing: "Installing…",
        };
        try {
          const path = await installOfficialClient((state) => button.setButtonText(labels[state]));
          this.plugin.settings.clientPath = path;
          await this.plugin.saveSettings();
          this.clientPathInput?.setValue(path);
          clientRow.setDesc(path);
          new Notice("Tunnel client installed and verified");
        } catch (error) {
          notifyFailure(error);
        } finally {
          button.setDisabled(false);
          button.setButtonText("Install official client");
        }
      });
    });

    new Setting(root)
      .setName("Existing executable")
      .setDesc("Optional. Use a previously downloaded tunnel-client.exe.")
      .addText((input) => {
        this.clientPathInput = input;
        input.setPlaceholder("C:\\path\\to\\tunnel-client.exe");
        input.setValue(this.plugin.settings.clientPath);
        input.onChange(async (value) => {
          this.plugin.settings.clientPath = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(root)
      .setName("Tunnel ID")
      .setDesc("Create or copy your tunnel ID in OpenAI Platform.")
      .addText((input) => {
        input.setPlaceholder("tunnel_…");
        input.setValue(this.plugin.settings.tunnelId);
        input.onChange(async (value) => {
          this.plugin.settings.tunnelId = value.trim();
          await this.plugin.saveSettings();
          if (value.trim() && !isValidTunnelId(value)) {
            input.inputEl.setAttribute("aria-invalid", "true");
          } else {
            input.inputEl.removeAttribute("aria-invalid");
          }
        });
      })
      .addButton((button) =>
        button.setButtonText("Open tunnels").onClick(() => window.open(URL_TUNNELS, "_blank")),
      );

    this.credentialRow = new Setting(root)
      .setName("Runtime API key")
      .setDesc("Encrypted by Windows and stored outside your vault.");
    this.credentialRow.addText((input) => {
      this.credentialInput = input;
      input.setPlaceholder("Paste key once");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.credentialRow.addButton((button) =>
      button.setButtonText("Save key").onClick(async () => {
        const value = this.credentialInput?.getValue() ?? "";
        try {
          await this.plugin.secrets.saveKey(value);
          this.credentialInput?.setValue("");
          new Notice("Runtime key saved securely");
          await this.updateCredential();
        } catch (error) {
          notifyFailure(error);
        }
      }),
    );
    this.credentialRow.addButton((button) =>
      button.setButtonText("Open keys").onClick(() => window.open(URL_API_KEYS, "_blank")),
    );
    void this.updateCredential();

    new Setting(root).setName("Advanced").setHeading();
    new Setting(root)
      .setName("Local MCP endpoint")
      .setDesc("Vault as MCP uses port 8765 by default. Local addresses only.")
      .addText((input) => {
        input.setValue(this.plugin.settings.mcpUrl);
        input.onChange(async (value) => {
          if (parseLocalMcpEndpoint(value)) {
            this.plugin.settings.mcpUrl = value.trim();
            await this.plugin.saveSettings();
            input.inputEl.removeAttribute("aria-invalid");
          } else {
            input.inputEl.setAttribute("aria-invalid", "true");
          }
        });
      });

    new Setting(root)
      .setName("Forget runtime key")
      .setDesc("Delete the encrypted key stored for this Windows account.")
      .addButton((button) => {
        button.setWarning();
        button.setButtonText("Forget key").onClick(async () => {
          try {
            this.plugin.manager.disconnect();
            await this.plugin.secrets.forgetKey();
            await this.updateCredential();
            new Notice("Runtime key removed");
          } catch (error) {
            notifyFailure(error);
          }
        });
      });
  }

  private async updateCredential(): Promise<void> {
    if (!this.credentialRow) return;
    try {
      const exists = await this.plugin.secrets.hasKey();
      this.credentialRow.setDesc(
        exists
          ? "Saved for this Windows user. The key is never stored in the vault."
          : "Not configured. Use a restricted key with Tunnels: Read + Use.",
      );
    } catch {
      this.credentialRow.setDesc("Unable to access Windows credential storage.");
    }
  }

  updateConnection(): void {
    if (!this.connectionRow) return;
    const snapshot = this.plugin.manager.snapshot;
    this.connectionRow.setDesc(snapshot.detail);
    this.connectButton?.setButtonText(snapshot.managed ? "Disconnect" : "Connect");
    this.connectButton?.setDisabled(snapshot.state === "starting");
    this.dashboardButton?.setDisabled(!snapshot.dashboardUrl);
  }
}

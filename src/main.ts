import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type ButtonComponent,
  type TextComponent,
} from "obsidian";
import { validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { TunnelManager } from "./manager";
import { inspectVaultAsMcp } from "./prerequisites";
import { DEFAULT_SETTINGS, type TunnelSettings } from "./types";
import { hasValidConfiguration, isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { WindowsSecretStore } from "./windows";

const PLATFORM_TUNNELS = "https://platform.openai.com/settings/organization/tunnels";
const PLATFORM_KEYS = "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_PLUGINS = "https://chatgpt.com/#settings/Connectors";
const VAULT_MCP_PLUGIN = "obsidian://show-plugin?id=vault-as-mcp";

function notifyFailure(error: unknown): void {
  new Notice(error instanceof Error ? error.message : "Operation failed");
}

function openLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Only the OpenAI tunnel runs here; Vault as MCP owns the actual MCP server. */
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

    // Do not block Obsidian startup or duplicate Vault as MCP's server lifecycle.
    this.app.workspace.onLayoutReady(() => this.manager.begin());
  }

  onunload(): void {
    this.manager?.dispose();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * Progressive disclosure: setup is visible until configured, then the user
 * normally sees only connection state and automatic startup.
 *
 * All UI elements use Obsidian's native Setting components and current theme.
 */
class TunnelSettingsTab extends PluginSettingTab {
  private expanded: boolean | null = null;
  private advancedExpanded = false;
  private credentialChecked = false;

  private connectionRow: Setting | null = null;
  private connectButton: ButtonComponent | null = null;
  private dashboardButton: ButtonComponent | null = null;
  private vaultRow: Setting | null = null;
  private clientRow: Setting | null = null;
  private credentialRow: Setting | null = null;
  private credentialInput: TextComponent | null = null;
  private clientPathInput: TextComponent | null = null;
  private localTokenRow: Setting | null = null;
  private localTokenInput: TextComponent | null = null;

  constructor(app: App, private readonly plugin: ObsidianMcpTunnel) {
    super(app, plugin);
  }

  display(): void {
    const root = this.containerEl;
    root.empty();

    if (this.expanded === null) {
      const settings = this.plugin.settings;
      this.expanded = !hasValidConfiguration(settings.clientPath, settings.tunnelId, settings.mcpUrl);
    }

    new Setting(root).setName("MCP Tunnel").setHeading();
    root.createEl("p", {
      text: "Connect Obsidian to ChatGPT through Vault as MCP.",
      cls: "setting-item-description",
    });

    this.connectionRow = new Setting(root).setName("Connection");
    this.connectionRow.addButton((button) => {
      this.connectButton = button;
      button.setButtonText("Connect").onClick(async () => {
        try {
          if (this.plugin.manager.snapshot.managed) {
            this.plugin.manager.disconnect();
          } else {
            await this.plugin.manager.connectNow();
          }
        } catch (error) {
          notifyFailure(error);
        }
      });
    });
    this.connectionRow.addButton((button) => {
      this.dashboardButton = button;
      button.setButtonText("Details").onClick(() => {
        const url = this.plugin.manager.snapshot.dashboardUrl;
        if (url) openLink(url);
      });
    });
    this.updateConnection();

    new Setting(root)
      .setName("Connect automatically")
      .setDesc("Start the tunnel when Obsidian opens.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoConnect).onChange(async (value) => {
          this.plugin.settings.autoConnect = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.manager.connectNow();
        }),
      );

    new Setting(root)
      .setName("Configuration")
      .setDesc("One-time setup. No PowerShell or manual scripts required.")
      .addButton((button) =>
        button
          .setButtonText(this.expanded ? "Hide" : "Manage")
          .onClick(() => {
            this.expanded = !this.expanded;
            this.display();
          }),
      );

    if (!this.expanded) {
      this.vaultRow = null;
      this.clientRow = null;
      this.credentialRow = null;
      if (!this.credentialChecked) {
        this.credentialChecked = true;
        void this.plugin.secrets.hasKey().then((exists) => {
          if (!exists && !this.expanded) {
            this.expanded = true;
            this.display();
          }
        }).catch(() => {
          this.expanded = true;
          this.display();
        });
      }
      return;
    }

    new Setting(root).setName("Setup").setHeading();

    this.vaultRow = new Setting(root)
      .setName("1. Vault as MCP")
      .setDesc("Checking installed plugin and local MCP endpoint…")
      .addButton((button) =>
        button
          .setButtonText("Open plugin")
          .onClick(() => openLink(VAULT_MCP_PLUGIN)),
      );
    void this.refreshVaultStatus();

    this.clientRow = new Setting(root)
      .setName("2. Tunnel client")
      .setDesc("Checking executable…");
    this.clientRow.addButton((button) => {
      button.setButtonText("Install").onClick(async () => {
        button.setDisabled(true);
        const labels: Record<InstallProgress, string> = {
          metadata: "Checking…",
          downloading: "Downloading…",
          verifying: "Verifying…",
          installing: "Installing…",
        };
        try {
          const path = await installOfficialClient((state) => button.setButtonText(labels[state]));
          this.plugin.settings.clientPath = path;
          await this.plugin.saveSettings();
          this.clientPathInput?.setValue(path);
          this.clientRow?.setDesc("Official client and cloudflared installed.");
          new Notice("Official tunnel client installed");
        } catch (error) {
          notifyFailure(error);
        } finally {
          button.setDisabled(false);
          button.setButtonText("Install");
        }
      });
    });
    void this.refreshClientStatus();

    new Setting(root)
      .setName("3. Tunnel ID")
      .setDesc("Create a tunnel in OpenAI Platform and paste its ID.")
      .addText((input) => {
        input.setPlaceholder("tunnel_…");
        input.setValue(this.plugin.settings.tunnelId);
        input.onChange(async (value) => {
          this.plugin.settings.tunnelId = value.trim();
          await this.plugin.saveSettings();
          input.inputEl.toggleAttribute("aria-invalid", Boolean(value.trim()) && !isValidTunnelId(value));
        });
      })
      .addButton((button) =>
        button.setButtonText("Open tunnels").onClick(() => openLink(PLATFORM_TUNNELS)),
      );

    this.credentialRow = new Setting(root)
      .setName("4. Runtime API key")
      .setDesc("Save a restricted key with Tunnels: Read + Use. Encrypted locally.");
    this.credentialRow.addText((input) => {
      this.credentialInput = input;
      input.setPlaceholder("Paste key once");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.credentialRow.addButton((button) =>
      button.setButtonText("Save").onClick(async () => {
        try {
          await this.plugin.secrets.saveKey(this.credentialInput?.getValue() ?? "");
          this.credentialInput?.setValue("");
          new Notice("Runtime key saved securely");
          await this.refreshCredentialStatus();
          // Apply a replacement key immediately rather than waiting for a restart.
          this.plugin.manager.disconnect();
          await this.plugin.manager.connectNow();
        } catch (error) {
          notifyFailure(error);
        }
      }),
    );
    this.credentialRow.addButton((button) =>
      button.setButtonText("Open keys").onClick(() => openLink(PLATFORM_KEYS)),
    );
    void this.refreshCredentialStatus();

    new Setting(root)
      .setName("ChatGPT")
      .setDesc("Add an MCP connection with the Tunnel option using the same Tunnel ID.")
      .addButton((button) =>
        button.setButtonText("Open ChatGPT").onClick(() => openLink(CHATGPT_PLUGINS)),
      )
      .addButton((button) =>
        button
          .setButtonText("Copy Tunnel ID")
          .setDisabled(!isValidTunnelId(this.plugin.settings.tunnelId))
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.plugin.settings.tunnelId);
              new Notice("Tunnel ID copied");
            } catch {
              new Notice("Unable to copy the Tunnel ID");
            }
          }),
      );

    new Setting(root)
      .setName("Advanced")
      .setDesc("Optional. Reuse an existing executable or change the MCP port.")
      .addButton((button) =>
        button.setButtonText(this.advancedExpanded ? "Hide" : "Show").onClick(() => {
          this.advancedExpanded = !this.advancedExpanded;
          this.display();
        }),
      );
    if (!this.advancedExpanded) return;

    this.localTokenRow = new Setting(root)
      .setName("Vault as MCP bearer token")
      .setDesc("Optional. Needed only if Vault as MCP has bearer authentication enabled.");
    this.localTokenRow.addText((input) => {
      this.localTokenInput = input;
      input.setPlaceholder("Paste local token");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.localTokenRow.addButton((button) =>
      button.setButtonText("Save").onClick(async () => {
        try {
          await this.plugin.secrets.saveMcpToken(this.localTokenInput?.getValue() ?? "");
          this.localTokenInput?.setValue("");
          await this.refreshLocalTokenStatus();
          this.plugin.manager.disconnect();
          await this.plugin.manager.connectNow();
          new Notice("Local MCP token saved securely");
        } catch (error) {
          notifyFailure(error);
        }
      }),
    );
    this.localTokenRow.addButton((button) =>
      button.setButtonText("Forget").onClick(async () => {
        try {
          this.plugin.manager.disconnect();
          await this.plugin.secrets.forgetMcpToken();
          await this.refreshLocalTokenStatus();
          new Notice("Local MCP token removed");
        } catch (error) {
          notifyFailure(error);
        }
      }),
    );
    void this.refreshLocalTokenStatus();

    new Setting(root)
      .setName("Executable path")
      .setDesc("For an existing official installation. Keep cloudflared.exe beside tunnel-client.exe.")
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
      .setName("MCP endpoint")
      .setDesc("Vault as MCP defaults to 127.0.0.1:8765. Local addresses only.")
      .addText((input) => {
        input.setValue(this.plugin.settings.mcpUrl);
        input.onChange(async (value) => {
          if (parseLocalMcpEndpoint(value)) {
            this.plugin.settings.mcpUrl = value.trim();
            await this.plugin.saveSettings();
            input.inputEl.removeAttribute("aria-invalid");
            void this.refreshVaultStatus();
          } else {
            input.inputEl.setAttribute("aria-invalid", "true");
          }
        });
      });
    new Setting(root)
      .setName("Forget saved key")
      .setDesc("Remove the encrypted key from this Windows account.")
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText("Forget key")
          .onClick(async () => {
            try {
              this.plugin.manager.disconnect();
              await this.plugin.secrets.forgetKey();
              await this.refreshCredentialStatus();
              new Notice("Saved runtime key removed");
            } catch (error) {
              notifyFailure(error);
            }
          }),
      );
  }

  private async refreshVaultStatus(): Promise<void> {
    const row = this.vaultRow;
    if (!row) return;
    try {
      const state = await inspectVaultAsMcp(this.app, this.plugin.settings.mcpUrl);
      if (this.vaultRow !== row) return;
      if (state.authenticationRequired) {
        const hasToken = await this.plugin.secrets.hasMcpToken();
        if (this.vaultRow !== row) return;
        row.setDesc(
          hasToken
            ? "Installed · Local bearer authentication is enabled"
            : "Local MCP requires a bearer token. Add it under Advanced.",
        );
        if (!hasToken && !this.advancedExpanded) {
          this.advancedExpanded = true;
          this.display();
        }
        return;
      }
      row.setDesc(
        !state.installed
          ? "Not installed. Install Vault as MCP from Obsidian Community plugins."
          : state.endpointResponding
            ? "Installed · Local MCP server responding"
            : "Installed · Enable its server and Auto-start server setting.",
      );
    } catch {
      if (this.vaultRow === row) row.setDesc("Unable to check the local MCP server.");
    }
  }

  private async refreshClientStatus(): Promise<void> {
    const row = this.clientRow;
    if (!row) return;
    const path = this.plugin.settings.clientPath;
    if (!path) {
      row.setDesc("Not installed. Download the official client with one click.");
      return;
    }
    try {
      await validateClientExecutable(path);
      if (this.clientRow === row) row.setDesc("Official client and cloudflared available.");
    } catch {
      if (this.clientRow === row) row.setDesc("Client incomplete or missing. Click Install to repair.");
    }
  }

  private async refreshCredentialStatus(): Promise<void> {
    const row = this.credentialRow;
    if (!row) return;
    try {
      const saved = await this.plugin.secrets.hasKey();
      if (this.credentialRow === row) {
        row.setDesc(
          saved
            ? "Saved securely for this Windows account. Leave the field empty to keep it."
            : "Not saved. Create a restricted key with Tunnels: Read + Use.",
        );
      }
    } catch {
      if (this.credentialRow === row) row.setDesc("Unable to read Windows credential storage.");
    }
  }

  private async refreshLocalTokenStatus(): Promise<void> {
    const row = this.localTokenRow;
    if (!row) return;
    try {
      const saved = await this.plugin.secrets.hasMcpToken();
      if (this.localTokenRow === row) {
        row.setDesc(
          saved
            ? "Token encrypted for this Windows account. Leave the input empty to keep it."
            : "Optional. Only required if Vault as MCP has bearer authentication enabled.",
        );
      }
    } catch {
      if (this.localTokenRow === row) row.setDesc("Unable to access the encrypted MCP token.");
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

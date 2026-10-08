import { Modal, Notice, Setting, type ButtonComponent, type TextComponent } from "obsidian";
import { validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { inspectVaultAsMcp } from "./prerequisites";
import { hasValidConfiguration, isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import type ChatGptMcpTunnel from "./main";

const PLATFORM_TUNNELS = "https://platform.openai.com/settings/organization/tunnels";
const PLATFORM_KEYS = "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_PLUGINS = "https://chatgpt.com/#settings/Connectors";
const VAULT_MCP = "obsidian://show-plugin?id=vault-as-mcp";

function showFailure(error: unknown): void {
  new Notice(error instanceof Error ? error.message : "Operation failed.");
}

function openPage(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Obsidian-native connection UI. Setup is disclosed only when requested or
 * incomplete; persistent preferences belong in the separate settings tab.
 */
export class ConnectionModal extends Modal {
  private setupVisible = false;
  private advancedVisible = false;
  private active = false;
  private statusRow: Setting | null = null;
  private connectButton: ButtonComponent | null = null;
  private dashboardButton: ButtonComponent | null = null;
  private vaultRow: Setting | null = null;
  private clientRow: Setting | null = null;
  private keyRow: Setting | null = null;
  private tokenRow: Setting | null = null;
  private keyInput: TextComponent | null = null;
  private tokenInput: TextComponent | null = null;
  private clientInput: TextComponent | null = null;
  private copyButton: ButtonComponent | null = null;

  constructor(private readonly plugin: ChatGptMcpTunnel) {
    super(plugin.app);
  }

  onOpen(): void {
    this.active = true;
    this.setTitle("ChatGPT MCP Tunnel");
    this.setupVisible = !this.isConfigured();
    this.render();
    void this.checkSetup();
  }

  onClose(): void {
    this.active = false;
    this.contentEl.empty();
    this.plugin.onConnectionModalClosed(this);
  }

  /** State updates do not replace the contents of focused inputs. */
  updateConnection(): void {
    if (!this.active || !this.statusRow) return;
    const snapshot = this.plugin.manager.snapshot;
    this.statusRow.setDesc(snapshot.detail);
    this.connectButton?.setButtonText(snapshot.managed ? "Disconnect" : "Connect");
    this.connectButton?.setDisabled(snapshot.state === "starting");
    this.dashboardButton?.setDisabled(!snapshot.dashboardUrl);
  }

  private isConfigured(): boolean {
    const s = this.plugin.settings;
    return hasValidConfiguration(s.clientPath, s.tunnelId, s.mcpUrl);
  }

  private async checkSetup(): Promise<void> {
    try {
      const [hasKey] = await Promise.all([
        this.plugin.secrets.hasKey(),
        this.plugin.ensureClientDetected(),
      ]);
      if (!this.active) return;
      if (!hasKey || !this.isConfigured()) this.setupVisible = true;
      this.render();
    } catch (error) {
      if (this.active) showFailure(error);
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    this.vaultRow = null;
    this.clientRow = null;
    this.keyRow = null;
    this.tokenRow = null;
    this.keyInput = null;
    this.tokenInput = null;
    this.clientInput = null;
    this.copyButton = null;

    this.statusRow = new Setting(root).setName("Connection");
    this.statusRow.addButton((button) => {
      this.connectButton = button;
      button.setButtonText("Connect").setCta().onClick(async () => {
        try {
          if (this.plugin.manager.snapshot.managed) {
            this.plugin.manager.disconnect();
          } else {
            await this.plugin.manager.connectNow();
          }
        } catch (error) {
          showFailure(error);
        }
      });
    });
    this.statusRow.addButton((button) => {
      this.dashboardButton = button;
      button.setButtonText("Details").onClick(() => {
        const url = this.plugin.manager.snapshot.dashboardUrl;
        if (url) openPage(url);
      });
    });
    this.updateConnection();

    new Setting(root)
      .setName("Setup")
      .setDesc(
        this.setupVisible
          ? "Complete the required steps once. No command-line setup."
          : "Your tunnel is managed automatically when Obsidian starts.",
      )
      .addButton((button) => {
        button.setButtonText(this.setupVisible ? "Hide" : "Configure").onClick(() => {
          this.setupVisible = !this.setupVisible;
          this.render();
        });
      });

    if (!this.setupVisible) return;

    this.vaultRow = new Setting(root)
      .setName("Vault as MCP")
      .setDesc("Checking local MCP server…")
      .addButton((button) => {
        button.setButtonText("Open plugin").onClick(() => openPage(VAULT_MCP));
      });
    void this.updateVault();

    this.clientRow = new Setting(root)
      .setName("Tunnel client")
      .setDesc("Checking for an existing official installation…");
    this.clientRow.addButton((button) => {
      button.setButtonText("Install").onClick(async () => {
        button.setDisabled(true);
        const progress: Record<InstallProgress, string> = {
          metadata: "Checking…",
          downloading: "Downloading…",
          verifying: "Verifying…",
          installing: "Installing…",
        };
        try {
          const path = await installOfficialClient((state) => button.setButtonText(progress[state]));
          this.plugin.settings.clientPath = path;
          await this.plugin.saveSettings();
          if (!this.active) return;
          this.clientRow?.setDesc("Official client installed and ready.");
          this.clientInput?.setValue(path);
          new Notice("Official tunnel client installed");
        } catch (error) {
          showFailure(error);
        } finally {
          button.setButtonText("Install").setDisabled(false);
        }
      });
    });
    this.clientRow.addButton((button) => {
      button.setButtonText("Detect").onClick(async () => {
        button.setDisabled(true);
        try {
          const found = await this.plugin.ensureClientDetected(true);
          if (this.active) {
            this.clientRow?.setDesc(
              found ? "Existing official client found and ready." :
                "Not found in common locations. Install or set its path under Advanced.",
            );
          }
        } catch (error) {
          showFailure(error);
        } finally {
          button.setDisabled(false);
        }
      });
    });
    void this.updateClient();

    new Setting(root)
      .setName("Tunnel ID")
      .setDesc("Create or find your tunnel in OpenAI Platform.")
      .addText((input) => {
        input.setPlaceholder("tunnel_…").setValue(this.plugin.settings.tunnelId);
        input.onChange(async (value) => {
          this.plugin.settings.tunnelId = value.trim();
          input.inputEl.toggleAttribute("aria-invalid", Boolean(value.trim()) && !isValidTunnelId(value));
          this.copyButton?.setDisabled(!isValidTunnelId(value));
          await this.plugin.saveSettings();
        });
      })
      .addButton((button) => {
        button.setButtonText("Open tunnels").onClick(() => openPage(PLATFORM_TUNNELS));
      });

    this.keyRow = new Setting(root)
      .setName("Runtime API key")
      .setDesc("Restricted OpenAI key with Tunnels: Read + Use. Encrypted by Windows.");
    this.keyRow.addText((input) => {
      this.keyInput = input;
      input.setPlaceholder("Paste key once");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.keyRow.addButton((button) => {
      button.setButtonText("Save").onClick(async () => {
        try {
          await this.plugin.secrets.saveKey(this.keyInput?.getValue() ?? "");
          this.keyInput?.setValue("");
          await this.updateKey();
          this.plugin.manager.disconnect();
          await this.plugin.manager.connectNow();
          new Notice("Runtime key saved");
        } catch (error) {
          showFailure(error);
        }
      });
    });
    this.keyRow.addButton((button) => {
      button.setButtonText("Open keys").onClick(() => openPage(PLATFORM_KEYS));
    });
    void this.updateKey();

    new Setting(root)
      .setName("ChatGPT")
      .setDesc("In ChatGPT, add an MCP connection using the Tunnel option and the same Tunnel ID.")
      .addButton((button) => {
        button.setButtonText("Open ChatGPT").onClick(() => openPage(CHATGPT_PLUGINS));
      })
      .addButton((button) => {
        this.copyButton = button;
        button
          .setButtonText("Copy Tunnel ID")
          .setDisabled(!isValidTunnelId(this.plugin.settings.tunnelId))
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.plugin.settings.tunnelId);
              new Notice("Tunnel ID copied");
            } catch {
              new Notice("Could not copy Tunnel ID");
            }
          });
      });

    new Setting(root)
      .setName("Advanced")
      .setDesc("Optional local authentication and existing client path.")
      .addButton((button) => {
        button.setButtonText(this.advancedVisible ? "Hide" : "Show").onClick(() => {
          this.advancedVisible = !this.advancedVisible;
          this.render();
        });
      });

    if (this.advancedVisible) this.renderAdvanced(root);
  }

  private renderAdvanced(root: HTMLElement): void {
    new Setting(root)
      .setName("Existing executable")
      .setDesc("Use an official tunnel-client.exe with cloudflared.exe in the same folder.")
      .addText((input) => {
        this.clientInput = input;
        input.setPlaceholder("C:\\path\\to\\tunnel-client.exe");
        input.setValue(this.plugin.settings.clientPath);
      })
      .addButton((button) => {
        button.setButtonText("Use path").onClick(async () => {
          try {
            const path = this.clientInput?.getValue().trim() ?? "";
            await validateClientExecutable(path);
            this.plugin.settings.clientPath = path;
            await this.plugin.saveSettings();
            await this.updateClient();
            if (this.plugin.manager.snapshot.managed) {
              this.plugin.manager.disconnect();
              await this.plugin.manager.connectNow();
            }
            new Notice("Existing official client selected");
          } catch (error) {
            showFailure(error);
          }
        });
      })
      .addButton((button) => {
        button.setButtonText("Browse").onClick(() => {
          const picker = document.createElement("input");
          picker.type = "file";
          picker.accept = ".exe";
          picker.hidden = true;
          this.contentEl.appendChild(picker);
          picker.addEventListener("change", () => {
            void (async () => {
              try {
                const file = picker.files?.[0];
                if (!file) return;
                // Electron provides the actual local path of a user-selected
                // File. Never infer a path from a browser's fakepath value.
                const bridge = require("electron") as {
                  webUtils?: { getPathForFile?: (file: File) => string };
                };
                const path = bridge.webUtils?.getPathForFile?.(file);
                if (!path) {
                  throw new Error("File path is unavailable. Enter the executable path manually.");
                }
                await validateClientExecutable(path);
                this.plugin.settings.clientPath = path;
                await this.plugin.saveSettings();
                this.clientInput?.setValue(path);
                await this.updateClient();
                new Notice("Existing official client selected");
              } catch (error) {
                showFailure(error);
              } finally {
                picker.remove();
              }
            })();
          }, { once: true });
          picker.click();
        });
      });

    new Setting(root)
      .setName("Local MCP endpoint")
      .setDesc("Default: http://127.0.0.1:8765/mcp. Local addresses only.")
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

    this.tokenRow = new Setting(root)
      .setName("Vault as MCP bearer token")
      .setDesc("Required only when local bearer authentication is enabled.");
    this.tokenRow.addText((input) => {
      this.tokenInput = input;
      input.setPlaceholder("Paste local token");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.tokenRow.addButton((button) => {
      button.setButtonText("Save").onClick(async () => {
        try {
          await this.plugin.secrets.saveMcpToken(this.tokenInput?.getValue() ?? "");
          this.tokenInput?.setValue("");
          await this.updateToken();
          this.plugin.manager.disconnect();
          await this.plugin.manager.connectNow();
          new Notice("Local MCP token saved");
        } catch (error) {
          showFailure(error);
        }
      });
    });
    this.tokenRow.addButton((button) => {
      button.setButtonText("Forget").onClick(async () => {
        try {
          this.plugin.manager.disconnect();
          await this.plugin.secrets.forgetMcpToken();
          await this.updateToken();
          new Notice("Local MCP token removed");
        } catch (error) {
          showFailure(error);
        }
      });
    });
    void this.updateToken();

    new Setting(root)
      .setName("Forget runtime key")
      .setDesc("Remove the encrypted OpenAI runtime key from this Windows account.")
      .addButton((button) => {
        button.setWarning().setButtonText("Forget key").onClick(async () => {
          try {
            this.plugin.manager.disconnect();
            await this.plugin.secrets.forgetKey();
            await this.updateKey();
            new Notice("Saved runtime key removed");
          } catch (error) {
            showFailure(error);
          }
        });
      });
  }

  private async updateVault(): Promise<void> {
    const row = this.vaultRow;
    if (!row) return;
    try {
      const state = await inspectVaultAsMcp(this.app, this.plugin.settings.mcpUrl);
      if (this.vaultRow !== row || !this.active) return;
      row.setDesc(
        !state.installed
          ? "Vault as MCP is not installed. Install and enable it in Obsidian."
          : state.authenticationRequired
            ? "Local MCP server is running with bearer authentication."
            : state.endpointResponding
              ? "Local MCP server is running."
              : "Installed, but the local server is not responding.",
      );
      if (state.authenticationRequired && !(await this.plugin.secrets.hasMcpToken())) {
        if (this.vaultRow === row && this.active) {
          row.setDesc("Vault as MCP requires a bearer token. Add it under Advanced.");
        }
      }
    } catch {
      if (this.vaultRow === row && this.active) row.setDesc("Unable to check the local MCP server.");
    }
  }

  private async updateClient(): Promise<void> {
    const row = this.clientRow;
    if (!row) return;
    const path = this.plugin.settings.clientPath;
    if (!path) {
      row.setDesc("No client path selected. Use Detect, Install, or Advanced.");
      return;
    }
    try {
      await validateClientExecutable(path);
      if (this.clientRow === row && this.active) row.setDesc("Existing official client available.");
    } catch {
      if (this.clientRow === row && this.active) {
        row.setDesc("Client path is invalid or files are missing. Use Detect or Install.");
      }
    }
  }

  private async updateKey(): Promise<void> {
    const row = this.keyRow;
    if (!row) return;
    try {
      const saved = await this.plugin.secrets.hasKey();
      if (this.keyRow === row && this.active) row.setDesc(
        saved
          ? "Saved securely for this Windows account."
          : "Not saved. Create a restricted key with Tunnels: Read + Use.",
      );
    } catch {
      if (this.keyRow === row && this.active) row.setDesc("Unable to access Windows credentials.");
    }
  }

  private async updateToken(): Promise<void> {
    const row = this.tokenRow;
    if (!row) return;
    try {
      const saved = await this.plugin.secrets.hasMcpToken();
      if (this.tokenRow === row && this.active) row.setDesc(
        saved ? "Saved securely for this Windows account." : "No local MCP token saved.",
      );
    } catch {
      if (this.tokenRow === row && this.active) row.setDesc("Unable to access Windows credentials.");
    }
  }
}

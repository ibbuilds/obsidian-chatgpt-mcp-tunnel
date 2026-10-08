import {
  ItemView,
  Notice,
  Setting,
  type ButtonComponent,
  type TextComponent,
  type WorkspaceLeaf,
} from "obsidian";
import { isCompleteInstallation, validateClientExecutable } from "./binaries";
import { installOfficialClient, type InstallProgress } from "./installer";
import { inspectVaultAsMcp, type VaultMcpStatus } from "./prerequisites";
import { hasValidConfiguration, isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import type ChatGptMcpTunnel from "./main";

export const CONNECTION_VIEW_TYPE = "chatgpt-mcp-tunnel-connection";

const TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_URL = "https://chatgpt.com/#settings/Connectors";
const VAULT_MCP_URL = "obsidian://show-plugin?id=vault-as-mcp";

function openPage(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function showError(error: unknown): void {
  new Notice(error instanceof Error ? error.message : "Operation failed.");
}

function addExternalLink(setting: Setting, text: string, url: string): void {
  const link = setting.descEl.createEl("a", { text, href: url });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener noreferrer");
}

/**
 * A docked Obsidian ItemView, never a Modal.
 *
 * The vault remains interactive; the panel stays in the right sidebar and
 * uses native Settings, TextComponents and Obsidian's theme variables.
 */
export class ConnectionView extends ItemView {
  private ready = false;
  private setupExpanded = false;
  private setupTouched = false;
  private advancedExpanded = false;
  private editRuntimeKey = false;
  private editMcpToken = false;
  private vault: VaultMcpStatus | null = null;
  private clientAvailable = false;
  private runtimeKeySaved = false;
  private mcpTokenSaved = false;
  private statusRow: Setting | null = null;
  private toggleButton: ButtonComponent | null = null;
  private clientRow: Setting | null = null;
  private keyRow: Setting | null = null;
  private tokenRow: Setting | null = null;
  private keyInput: TextComponent | null = null;
  private tokenInput: TextComponent | null = null;
  private executableInput: TextComponent | null = null;
  private copyButton: ButtonComponent | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private renderSequence = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ChatGptMcpTunnel) {
    super(leaf);
  }

  getViewType(): string {
    return CONNECTION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ChatGPT MCP Tunnel";
  }

  getIcon(): string {
    return "plug-zap";
  }

  async onOpen(): Promise<void> {
    this.ready = true;
    this.contentEl.addClass("chatgpt-mcp-tunnel-panel");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "Checking local connection…",
      cls: "setting-item-description",
    });
    await this.refreshPrerequisites(true);
  }

  async onClose(): Promise<void> {
    this.ready = false;
    ++this.renderSequence;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.plugin.saveSettings();
    }
    this.contentEl.empty();
  }

  updateConnection(): void {
    if (!this.ready || !this.statusRow) return;
    const snapshot = this.plugin.manager.snapshot;
    this.statusRow.setDesc(snapshot.detail);
    this.toggleButton?.setButtonText(snapshot.managed ? "Disconnect" : "Connect");
    this.toggleButton?.setDisabled(snapshot.state === "starting");
    // Use Obsidian's existing primary-button styling only for Connect.
    this.toggleButton?.buttonEl.toggleClass("mod-cta", !snapshot.managed);
  }

  private configReady(): boolean {
    const s = this.plugin.settings;
    return (
      hasValidConfiguration(s.clientPath, s.tunnelId, s.mcpUrl) &&
      this.clientAvailable &&
      this.runtimeKeySaved
    );
  }

  private async refreshPrerequisites(initial = false): Promise<void> {
    const sequence = ++this.renderSequence;
    try {
      await this.plugin.ensureClientDetected();
      const [clientAvailable, runtimeKeySaved, mcpTokenSaved, vault] = await Promise.all([
        isCompleteInstallation(this.plugin.settings.clientPath),
        this.plugin.secrets.hasKey(),
        this.plugin.secrets.hasMcpToken(),
        inspectVaultAsMcp(this.app, this.plugin.settings.mcpUrl),
      ]);
      if (!this.ready || sequence !== this.renderSequence) return;
      this.clientAvailable = clientAvailable;
      this.runtimeKeySaved = runtimeKeySaved;
      this.mcpTokenSaved = mcpTokenSaved;
      this.vault = vault;
      if (initial && !this.setupTouched) {
        this.setupExpanded = !this.configReady() || !vault.endpointResponding;
      }
      this.render();
    } catch (error) {
      if (this.ready && sequence === this.renderSequence) {
        showError(error);
        this.render();
      }
    }
  }

  private queueSettingsSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveSettings().catch(showError);
    }, 350);
  }

  private async saveImmediately(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.plugin.saveSettings();
  }

  private render(): void {
    if (!this.ready) return;
    const root = this.contentEl;
    root.empty();
    this.clientRow = null;
    this.keyRow = null;
    this.tokenRow = null;
    this.keyInput = null;
    this.tokenInput = null;
    this.executableInput = null;
    this.copyButton = null;

    this.statusRow = new Setting(root).setName("Connection");
    this.statusRow.addButton((button) => {
      this.toggleButton = button;
      button.setButtonText("Connect").onClick(async () => {
        try {
          await this.saveImmediately();
          if (this.plugin.manager.snapshot.managed) {
            this.plugin.manager.disconnect();
          } else {
            await this.plugin.manager.connectNow();
          }
        } catch (error) {
          showError(error);
        }
      });
    });
    this.updateConnection();

    const setup = new Setting(root)
      .setName("Configuration")
      .setDesc(
        this.configReady()
          ? "Saved locally. No setup needed on next launch."
          : "Complete the connection details once.",
      );
    setup.addButton((button) => {
      button
        .setButtonText(this.setupExpanded ? "Hide" : "Edit")
        .onClick(() => {
          this.setupTouched = true;
          this.setupExpanded = !this.setupExpanded;
          this.render();
        });
    });

    if (this.setupExpanded) {
      new Setting(root).setName("Local connection").setHeading();
      this.renderVault(root);
      this.renderClient(root);
      this.renderTunnelId(root);
      this.renderRuntimeKey(root);
      this.renderAdvanced(root);
    }

    this.renderChatGpt(root);
  }

  private renderVault(root: HTMLElement): void {
    const s = this.vault;
    const row = new Setting(root).setName("Vault as MCP");
    if (s?.authenticationRequired && !this.mcpTokenSaved) {
      row.setDesc("Authentication required. Add the local token under Advanced.");
    } else if (s?.endpointResponding) {
      row.setDesc("Local MCP server running.");
    } else if (s?.installed) {
      row.setDesc("Installed. Start the server in Vault as MCP.");
    } else if (s) {
      row.setDesc("Install and enable the Vault as MCP plugin.");
    } else {
      row.setDesc("Checking local server…");
    }
    if (!s?.endpointResponding || (s.authenticationRequired && !this.mcpTokenSaved)) {
      row.addButton((button) =>
        button.setButtonText("Open plugin").onClick(() => openPage(VAULT_MCP_URL)),
      );
    }
  }

  private renderClient(root: HTMLElement): void {
    const row = new Setting(root).setName("OpenAI tunnel client");
    this.clientRow = row;
    row.setDesc(
      this.clientAvailable
        ? "Client files found. Ready to use."
        : "Find your existing client or install the official one.",
    );
    if (!this.clientAvailable) {
      row.addButton((button) => {
        button.setButtonText("Detect").onClick(async () => {
          button.setDisabled(true);
          try {
            const found = await this.plugin.ensureClientDetected(true);
            if (found) {
              this.clientAvailable = true;
              this.clientRow?.setDesc("Client files found. Ready to use.");
              this.render();
            } else {
              this.clientRow?.setDesc("Not found in common folders. Use Install or Advanced → Browse.");
            }
          } catch (error) {
            showError(error);
          } finally {
            button.setDisabled(false);
          }
        });
      });
      row.addButton((button) => {
        button.setButtonText("Install").onClick(async () => {
          button.setDisabled(true);
          const labels: Record<InstallProgress, string> = {
            metadata: "Checking…",
            downloading: "Downloading…",
            verifying: "Verifying…",
            installing: "Installing…",
          };
          try {
            const path = await installOfficialClient((state) => {
              if (this.ready) button.setButtonText(labels[state]);
            });
            this.plugin.settings.clientPath = path;
            await this.saveImmediately();
            this.clientAvailable = true;
            this.render();
            new Notice("OpenAI tunnel client installed");
          } catch (error) {
            showError(error);
          } finally {
            button.setDisabled(false);
            button.setButtonText("Install");
          }
        });
      });
    } else {
      row.addButton((button) =>
        button.setButtonText("Change").onClick(() => {
          this.advancedExpanded = true;
          this.render();
        }),
      );
    }
  }

  private renderTunnelId(root: HTMLElement): void {
    const row = new Setting(root)
      .setName("Tunnel ID")
      .setDesc("Use the tunnel created in your OpenAI organization.");
    addExternalLink(row, "OpenAI tunnels", TUNNELS_URL);
    row.addText((input) => {
      input
        .setPlaceholder("tunnel_…")
        .setValue(this.plugin.settings.tunnelId)
        .onChange((value) => {
          this.plugin.settings.tunnelId = value.trim();
          this.queueSettingsSave();
          input.inputEl.toggleAttribute(
            "aria-invalid", Boolean(value.trim()) && !isValidTunnelId(value),
          );
          this.copyButton?.setDisabled(!isValidTunnelId(value));
        });
    });
  }

  private renderRuntimeKey(root: HTMLElement): void {
    this.keyRow = new Setting(root).setName("Runtime API key");
    if (this.runtimeKeySaved && !this.editRuntimeKey) {
      this.keyRow.setDesc("Saved securely for this Windows account.");
      this.keyRow.addButton((button) =>
        button.setButtonText("Replace").onClick(() => {
          this.editRuntimeKey = true;
          this.render();
        }),
      );
      return;
    }
    this.keyRow.setDesc("Restricted key with Tunnels: Read + Use.");
    addExternalLink(this.keyRow, "OpenAI API keys", KEYS_URL);
    this.keyRow.addText((input) => {
      this.keyInput = input;
      input.setPlaceholder("Paste key once");
      input.inputEl.type = "password";
      input.inputEl.autocomplete = "off";
    });
    this.keyRow.addButton((button) =>
      button.setButtonText("Save").onClick(async () => {
        try {
          await this.plugin.secrets.saveKey(this.keyInput?.getValue() ?? "");
          this.runtimeKeySaved = true;
          this.editRuntimeKey = false;
          if (this.plugin.manager.snapshot.managed) {
            this.plugin.manager.disconnect();
            await this.plugin.manager.connectNow();
          }
          this.render();
          new Notice("Runtime API key saved securely");
        } catch (error) {
          showError(error);
        }
      }),
    );
  }

  private renderChatGpt(root: HTMLElement): void {
    const validId = isValidTunnelId(this.plugin.settings.tunnelId);
    const row = new Setting(root)
      .setName("ChatGPT")
      .setDesc("Use the Tunnel option in ChatGPT with the same Tunnel ID.");
    row.addButton((button) => {
      this.copyButton = button;
      button
        .setButtonText("Copy ID")
        .setDisabled(!validId)
        .onClick(async () => {
          try {
            await navigator.clipboard.writeText(this.plugin.settings.tunnelId);
            new Notice("Tunnel ID copied");
          } catch {
            new Notice("Unable to copy the Tunnel ID");
          }
        });
    });
    row.addButton((button) =>
      button.setButtonText("Open ChatGPT").onClick(() => openPage(CHATGPT_URL)),
    );
  }

  private renderAdvanced(root: HTMLElement): void {
    const advanced = new Setting(root)
      .setName("Advanced")
      .setDesc("Only needed for a custom install or local MCP authentication.");
    advanced.addButton((button) =>
      button
        .setButtonText(this.advancedExpanded ? "Hide" : "Show")
        .onClick(() => {
          this.advancedExpanded = !this.advancedExpanded;
          this.render();
        }),
    );
    if (!this.advancedExpanded) return;

    const client = new Setting(root)
      .setName("Existing executable")
      .setDesc("Select tunnel-client.exe with cloudflared.exe alongside it.");
    client.addText((input) => {
      this.executableInput = input
        .setPlaceholder("C:\\path\\to\\tunnel-client.exe")
        .setValue(this.plugin.settings.clientPath);
    });
    client.addButton((button) =>
      button.setButtonText("Use path").onClick(async () => {
        try {
          await this.selectClient(this.executableInput?.getValue().trim() ?? "");
        } catch (error) {
          showError(error);
        }
      }),
    );
    client.addButton((button) =>
      button.setButtonText("Browse").onClick(() => this.browseClient()),
    );

    const endpoint = new Setting(root)
      .setName("Local MCP endpoint")
      .setDesc("127.0.0.1:8765/mcp by default. Local addresses only.");
    endpoint.addText((input) => {
      input.setValue(this.plugin.settings.mcpUrl);
      input.onChange((value) => {
        if (parseLocalMcpEndpoint(value)) {
          this.plugin.settings.mcpUrl = value.trim();
          this.queueSettingsSave();
          input.inputEl.removeAttribute("aria-invalid");
        } else {
          input.inputEl.setAttribute("aria-invalid", "true");
        }
      });
    });

    this.tokenRow = new Setting(root).setName("Local MCP bearer token");
    if (this.mcpTokenSaved && !this.editMcpToken) {
      this.tokenRow.setDesc("Saved securely for this Windows account.");
      this.tokenRow.addButton((button) =>
        button.setButtonText("Replace").onClick(() => {
          this.editMcpToken = true;
          this.render();
        }),
      );
      this.tokenRow.addButton((button) =>
        button.setButtonText("Forget").onClick(async () => {
          try {
            this.plugin.manager.disconnect();
            await this.plugin.secrets.forgetMcpToken();
            this.mcpTokenSaved = false;
            this.render();
          } catch (error) {
            showError(error);
          }
        }),
      );
    } else {
      this.tokenRow.setDesc("Only required if Vault as MCP uses bearer authentication.");
      this.tokenRow.addText((input) => {
        this.tokenInput = input;
        input.setPlaceholder("Paste local token");
        input.inputEl.type = "password";
        input.inputEl.autocomplete = "off";
      });
      this.tokenRow.addButton((button) =>
        button.setButtonText("Save").onClick(async () => {
          try {
            await this.plugin.secrets.saveMcpToken(this.tokenInput?.getValue() ?? "");
            this.mcpTokenSaved = true;
            this.editMcpToken = false;
            if (this.plugin.manager.snapshot.managed) {
              this.plugin.manager.disconnect();
              await this.plugin.manager.connectNow();
            }
            this.render();
            new Notice("Local token saved securely");
          } catch (error) {
            showError(error);
          }
        }),
      );
    }

    if (this.runtimeKeySaved) {
      new Setting(root)
        .setName("Remove runtime key")
        .setDesc("Delete the saved OpenAI key from this Windows account.")
        .addButton((button) =>
          button.setWarning().setButtonText("Forget key").onClick(async () => {
            try {
              this.plugin.manager.disconnect();
              await this.plugin.secrets.forgetKey();
              this.runtimeKeySaved = false;
              this.render();
            } catch (error) {
              showError(error);
            }
          }),
        );
    }

    const url = this.plugin.manager.snapshot.dashboardUrl;
    if (url) {
      new Setting(root)
        .setName("Local diagnostics")
        .setDesc("Open the official client's local health dashboard.")
        .addButton((button) =>
          button.setButtonText("Details").onClick(() => openPage(url)),
        );
    }
  }

  private async selectClient(path: string): Promise<void> {
    await validateClientExecutable(path);
    this.plugin.settings.clientPath = path;
    await this.saveImmediately();
    this.clientAvailable = true;
    if (this.plugin.manager.snapshot.managed) {
      this.plugin.manager.disconnect();
      await this.plugin.manager.connectNow();
    }
    this.render();
    new Notice("Existing client selected");
  }

  private browseClient(): void {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".exe";
    picker.hidden = true;
    this.contentEl.appendChild(picker);
    picker.addEventListener("cancel", () => picker.remove(), { once: true });
    picker.addEventListener("change", () => {
      void (async () => {
        try {
          const file = picker.files?.[0];
          if (!file) return;
          const electron = require("electron") as {
            webUtils?: { getPathForFile?: (file: File) => string };
          };
          const path = electron.webUtils?.getPathForFile?.(file);
          if (!path) throw new Error("Enter the executable path manually.");
          await this.selectClient(path);
        } catch (error) {
          showError(error);
        } finally {
          picker.remove();
        }
      })();
    }, { once: true });
    picker.click();
  }
}

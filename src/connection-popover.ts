import { ButtonComponent, TextComponent, ToggleComponent, setIcon } from "obsidian";
import { isValidTunnelId } from "./validation";
import { firstScreen, popoverPosition, statusCopy, type Screen, type SetupFacts } from "./ui-model";
import type { PopoverHost } from "./popover-host";

const URLS = {
  tunnels: "https://platform.openai.com/settings/organization/tunnels",
  keys: "https://platform.openai.com/settings/organization/api-keys",
  chatgpt: "https://chatgpt.com/#settings/Connectors",
  vault: "obsidian://show-plugin?id=vault-as-mcp",
};
let nextId = 0;

/** An anchored, non-modal popover. No workspace leaves, overlays or focus trap. */
export class ConnectionPopover {
  private root: HTMLDivElement | null = null;
  private body: HTMLElement | null = null;
  private feedback: HTMLElement | null = null;
  private screen: Screen = "loading";
  private facts: SetupFacts = { client: false, key: false, vault: "stopped", token: false };
  private disposers: Array<() => void> = [];
  private frame: number | null = null;
  private busy = false;
  private pendingInstall = false;
  private focusOnPosition = false;
  private draftId = "";
  private draftKey = "";
  private draftToken = "";
  private returnScreen: Screen = "home";
  private accountBack: Screen = "client";
  private statusUpdater: (() => void) | null = null;
  private readonly doc: Document;
  private readonly win: Window;

  constructor(private readonly anchor: HTMLElement, private readonly host: PopoverHost, private readonly onClose: () => void) {
    this.doc = anchor.ownerDocument;
    this.win = this.doc.defaultView!;
  }
  get isOpen(): boolean { return this.root !== null; }

  open(): void {
    if (this.root) return;
    this.draftId = this.host.settings.tunnelId;
    this.pendingInstall = this.host.installing;
    this.focusOnPosition = true;
    const root = this.doc.createElement("div");
    root.className = "cmt-popover";
    root.id = `cmt-popover-${++nextId}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-label", "ChatGPT MCP Tunnel");
    root.tabIndex = -1;
    this.root = root;
    root.style.visibility = "hidden";
    this.doc.body.appendChild(root);
    // Native browser top layer, with explicit light-dismiss below. Never showModal().
    if (typeof root.showPopover === "function") {
      root.setAttribute("popover", "manual");
      root.showPopover();
    }
    this.anchor.setAttribute("aria-expanded", "true");
    this.anchor.setAttribute("aria-controls", root.id);
    this.listen(this.doc, "pointerdown", (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(root) && !path.includes(this.anchor)) this.close(false);
    }, true);
    this.listen(this.doc, "keydown", (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Escape" && !key.isComposing) {
        key.preventDefault(); key.stopPropagation(); this.close(true);
      }
    }, true);
    this.listen(this.win, "resize", () => this.schedulePosition());
    this.listen(this.doc, "scroll", () => this.schedulePosition(), true);
    const Resize = (this.win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Resize) {
      const observer = new Resize(() => this.schedulePosition());
      observer.observe(root); observer.observe(this.anchor);
      this.disposers.push(() => observer.disconnect());
    }
    this.render();
    root.focus({ preventScroll: true });
    void this.load();
  }

  close(restoreFocus = false): void {
    const root = this.root;
    if (!root) return;
    this.root = null;
    this.body = null;
    this.feedback = null;
    this.statusUpdater = null;
    this.disposers.splice(0).forEach((dispose) => dispose());
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.draftKey = ""; this.draftToken = "";
    // Remove input values before detaching, without persisting credential drafts.
    root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
    root.remove();
    this.anchor.setAttribute("aria-expanded", "false");
    this.anchor.removeAttribute("aria-controls");
    if (restoreFocus && this.anchor.isConnected) this.anchor.focus({ preventScroll: true });
    this.onClose();
  }

  updateConnection(): void {
    if (!this.root) return;
    if (this.pendingInstall && !this.host.installing && !this.busy && this.screen === "client") {
      this.pendingInstall = false; void this.load(); return;
    }
    this.pendingInstall = this.host.installing;
    // Never replace focused forms in response to the periodic health update.
    this.statusUpdater?.();
    this.schedulePosition();
  }

  private listen(target: EventTarget, name: string, listener: EventListener, capture = false): void {
    target.addEventListener(name, listener, capture);
    this.disposers.push(() => target.removeEventListener(name, listener, capture));
  }

  private schedulePosition(): void {
    if (!this.root || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      if (!this.root) return;
      const rect = this.root.getBoundingClientRect();
      const p = popoverPosition(this.anchor.getBoundingClientRect(), rect.width, rect.height, this.win.innerWidth, this.win.innerHeight);
      this.root.style.left = `${p.left}px`;
      this.root.style.top = `${p.top}px`;
      this.root.style.visibility = "";
      if (this.focusOnPosition) { this.focusOnPosition = false; this.root.focus({ preventScroll: true }); }
    });
  }

  private async load(): Promise<void> {
    try {
      this.facts = await this.host.inspect();
      if (!this.root) return;
      this.go(firstScreen(this.facts, isValidTunnelId(this.host.settings.tunnelId), !!this.host.settings.chatgptLinked));
    } catch {
      if (!this.root) return;
      this.go("client");
      this.showFeedback("Couldn't check the local connection. Try again or choose your client file.", true);
    }
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.render();
  }

  private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  private button(parent: HTMLElement, label: string, action: () => void, kind = "secondary"): ButtonComponent {
    const button = new ButtonComponent(parent).setButtonText(label).onClick(action);
    button.buttonEl.classList.add("cmt-button", `cmt-${kind}`);
    if (kind === "primary") button.setCta();
    return button;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): ButtonComponent {
    const button = new ButtonComponent(parent).setIcon(icon).setTooltip(label).onClick(action);
    button.buttonEl.classList.add("cmt-icon-button");
    button.buttonEl.setAttribute("aria-label", label);
    return button;
  }

  private link(parent: HTMLElement, label: string, url: string): void {
    const link = this.element(parent, "a", "cmt-link", label);
    link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
  }

  private heading(step: string, title: string, description: string): void {
    this.element(this.body!, "div", "cmt-eyebrow", step);
    this.element(this.body!, "h3", "cmt-title", title);
    this.element(this.body!, "p", "cmt-description", description);
  }

  private row(parent: HTMLElement, label: string, value: string, ok: boolean): void {
    const row = this.element(parent, "div", "cmt-check-row");
    const icon = this.element(row, "span", ok ? "cmt-check is-ok" : "cmt-check");
    setIcon(icon, ok ? "check" : "minus");
    this.element(row, "span", "cmt-check-label", label);
    this.element(row, "span", "cmt-muted", value);
  }

  private field(parent: HTMLElement, label: string, value: string, placeholder: string, change: (value: string) => void, secret = false): TextComponent {
    const wrap = this.element(parent, "div", "cmt-field");
    const labelEl = this.element(wrap, "label", "cmt-label", label);
    const input = new TextComponent(wrap).setValue(value).setPlaceholder(placeholder).onChange(change);
    input.inputEl.id = `cmt-field-${++nextId}`;
    labelEl.htmlFor = input.inputEl.id;
    input.inputEl.spellcheck = false;
    input.inputEl.autocomplete = "off";
    if (secret) input.inputEl.type = "password";
    return input;
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    this.statusUpdater = null;
    root.replaceChildren();
    root.dataset.screen = this.screen;
    const header = this.element(root, "header", "cmt-header");
    if (this.screen === "settings" || this.screen === "account") {
      this.iconButton(header, "arrow-left", "Back", () => { if (!this.busy) this.go(this.screen === "settings" ? this.returnScreen : this.accountBack); });
    } else {
      const icon = this.element(header, "span", "cmt-brand-icon"); setIcon(icon, "plug-zap");
    }
    const brand = this.element(header, "div", "cmt-brand");
    this.element(brand, "strong", "", "ChatGPT");
    this.element(brand, "span", "cmt-muted", "MCP connection");
    if (this.screen !== "settings" && this.screen !== "loading") {
      this.iconButton(header, "settings-2", "Connection settings", () => {
        if (this.busy) return;
        this.returnScreen = this.screen;
        this.go("settings");
      });
    }
    this.iconButton(header, "x", "Close", () => this.close(true));
    this.body = this.element(root, "div", "cmt-body");
    switch (this.screen) {
      case "loading": this.element(this.body, "p", "cmt-description", "Checking your connection…"); break;
      case "client": this.renderClient(); break;
      case "account": this.renderAccount(); break;
      case "chatgpt": this.renderChatgpt(); break;
      case "home": this.renderHome(); break;
      case "settings": this.renderSettings(); break;
    }
    this.feedback = this.element(root, "div", "cmt-feedback");
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.feedback.hidden = true;
    this.schedulePosition();
  }

  private renderClient(): void {
    this.heading("1 OF 3 · LOCAL CONNECTION", "Connect this vault", "Use your existing OpenAI tunnel client. Nothing to reinstall if you already have it.");
    const checks = this.element(this.body!, "div", "cmt-checks");
    this.row(checks, "Vault as MCP", this.facts.vault === "running" ? "Running" : this.facts.vault === "authentication" ? "Token needed" : "Not running", this.facts.vault === "running");
    this.row(checks, "OpenAI client", this.facts.client ? "Found" : "Not selected", this.facts.client);
    if (this.facts.vault !== "running") {
      const help = this.element(this.body!, "p", "cmt-help");
      if (this.facts.vault === "authentication") {
        help.textContent = "Your local server needs its bearer token. Add it in connection settings.";
      } else {
        help.textContent = "Enable Vault as MCP and start its server. "; this.link(help, "Open plugin", URLS.vault);
      }
    }
    const actions = this.element(this.body!, "div", "cmt-actions");
    if (this.host.installing) {
      this.button(actions, "Installing client…", () => undefined, "primary").setDisabled(true);
      this.element(actions, "p", "cmt-help", "You can close this popover while the installation finishes.");
      return;
    }
    if (!this.facts.client) {
      this.button(actions, "Find existing client", () => void this.run("Looking in common folders…", async () => {
        const found = await this.host.findClient();
        this.facts = await this.host.inspect(); this.render();
        if (!found) this.showFeedback("Not found in common folders. Choose tunnel-client.exe below; it may be stored elsewhere.", false);
      }), "primary");
      const alternatives = this.element(actions, "div", "cmt-secondary-actions");
      this.button(alternatives, "Choose file", () => void this.run("Choose tunnel-client.exe…", async () => {
        if (await this.host.chooseClient(this.doc)) { this.facts = await this.host.inspect(); this.render(); }
      }), "quiet");
      this.button(alternatives, "Install client", () => void this.run("Installing the official client…", async () => {
        await this.host.installClient((message) => this.showFeedback(message, false));
        this.facts = await this.host.inspect(); this.render();
      }), "quiet").setDisabled(this.host.installing);
    } else {
      this.button(actions, this.facts.vault === "running" ? "Continue" : "Check again", () => {
        if (this.facts.vault !== "running") {
          void this.run("Checking Vault as MCP…", async () => { this.facts = await this.host.inspect(); this.render(); });
        } else this.go(this.facts.key && isValidTunnelId(this.host.settings.tunnelId) ? (this.host.settings.chatgptLinked ? "home" : "chatgpt") : "account");
      }, "primary");
      this.button(actions, "Use a different client", () => void this.run("Choose tunnel-client.exe…", async () => {
        if (await this.host.chooseClient(this.doc)) { this.facts = await this.host.inspect(); this.render(); }
      }), "quiet");
    }
  }

  private renderAccount(): void {
    this.heading("2 OF 3 · OPENAI", "Add your connection details", "Reuse the tunnel and API key you already created.");
    let submit: ButtonComponent;
    const validate = () => submit?.setDisabled(!isValidTunnelId(this.draftId) || (!this.facts.key && this.draftKey.trim().length < 16));
    this.field(this.body!, "Tunnel ID", this.draftId, "tunnel_…", (value) => { this.draftId = value.trim(); validate(); });
    const idHelp = this.element(this.body!, "p", "cmt-help"); this.link(idHelp, "Get a tunnel ID ↗", URLS.tunnels);
    if (this.facts.key && !this.draftKey) {
      const saved = this.element(this.body!, "div", "cmt-saved");
      this.element(saved, "span", "", "API key saved securely");
      this.button(saved, "Replace", () => { this.facts.key = false; this.render(); }, "quiet");
    } else {
      this.field(this.body!, "Runtime API key", this.draftKey, "Paste key once", (value) => { this.draftKey = value; validate(); }, true);
    }
    const keyHelp = this.element(this.body!, "p", "cmt-help", "Restricted key: Tunnels → Read + Use. ");
    this.link(keyHelp, "Create key ↗", URLS.keys);
    const actions = this.element(this.body!, "div", "cmt-actions");
    submit = this.button(actions, "Save & connect", () => void this.run("Saving and connecting…", async () => {
      await this.host.saveAccount(this.draftId, this.draftKey);
      this.draftKey = ""; this.facts.key = true;
      this.go(this.host.settings.chatgptLinked ? "home" : "chatgpt");
      await this.host.connect(); this.updateConnection();
    }), "primary"); validate();
    this.element(actions, "p", "cmt-footnote", "Your key is encrypted by Windows, outside this vault.");
  }

  private renderChatgpt(): void {
    this.heading("3 OF 3 · CHATGPT", "Add the tunnel in ChatGPT", "Add an MCP connection, select Tunnel, and use this ID. You only do this once.");
    const codeRow = this.element(this.body!, "div", "cmt-copy-row");
    this.element(codeRow, "code", "", this.host.settings.tunnelId);
    this.iconButton(codeRow, "copy", "Copy Tunnel ID", () => void this.run("", async () => {
      await this.win.navigator.clipboard.writeText(this.host.settings.tunnelId);
      this.showFeedback("Tunnel ID copied.", false);
    }));
    const connection = this.element(this.body!, "p", "cmt-help");
    const actions = this.element(this.body!, "div", "cmt-actions");
    const open = this.button(actions, "Open ChatGPT ↗", () => this.openPage(URLS.chatgpt), "primary");
    const retry = this.button(actions, "Connect tunnel", () => void this.run("Connecting…", async () => { await this.host.connect(); this.updateConnection(); }), "quiet");
    this.button(actions, "I've already added this tunnel", () => void this.run("", async () => {
      await this.host.acknowledgeChatgpt(); this.go("home");
    }), "quiet");
    this.statusUpdater = () => {
      const snapshot = this.host.snapshot;
      const ready = snapshot.state === "connected";
      connection.textContent = ready ? "Local tunnel ready. You can now add it in ChatGPT." : snapshot.detail;
      open.setDisabled(!ready);
      retry.buttonEl.hidden = ready || snapshot.managed || snapshot.state === "starting" || snapshot.state === "connecting";
    };
    this.statusUpdater();
  }

  private renderHome(): void {
    const title = this.element(this.body!, "h3", "cmt-title");
    const detail = this.element(this.body!, "p", "cmt-description");
    const state = this.element(this.body!, "div", "cmt-checks");
    const actions = this.element(this.body!, "div", "cmt-actions");
    const action = this.button(actions, "Connect", () => void this.run("", async () => {
      if (this.host.snapshot.managed || this.host.snapshot.state === "starting" || this.host.snapshot.state === "connecting") this.host.disconnect();
      else if (this.host.snapshot.state === "not-configured") await this.load();
      else await this.host.connect();
      this.updateConnection();
    }), "primary");
    const footer = this.element(actions, "p", "cmt-footnote"); this.link(footer, "Open ChatGPT ↗", URLS.chatgpt);
    this.statusUpdater = () => {
      const snapshot = this.host.snapshot, copy = statusCopy(snapshot);
      title.textContent = copy.title; detail.textContent = copy.text;
      action.setButtonText(copy.action);
      action.buttonEl.classList.toggle("mod-cta", !snapshot.managed);
      state.replaceChildren();
      this.row(state, "Local tunnel", snapshot.state === "connected" ? "Ready" : snapshot.managed ? "Starting" : "Stopped", snapshot.state === "connected");
      this.row(state, "Start with Obsidian", this.host.settings.autoConnect ? "On" : "Off", this.host.settings.autoConnect);
    }; this.statusUpdater();
  }

  private renderSettings(): void {
    this.heading("CONNECTION SETTINGS", "Only what you need", "Your saved details and local options.");
    const auto = this.element(this.body!, "div", "cmt-preference");
    const autoLabel = this.element(auto, "label", "cmt-label", "Start with Obsidian");
    const toggle = new ToggleComponent(auto).setValue(this.host.settings.autoConnect).onChange((value) => void this.run("", () => this.host.setAutoConnect(value)));
    toggle.toggleEl.setAttribute("aria-label", autoLabel.textContent!);
    const links = this.element(this.body!, "div", "cmt-settings-actions");
    this.button(links, "Edit OpenAI details", () => { this.accountBack = "settings"; this.go("account"); }, "quiet");
    this.button(links, "Change tunnel client", () => this.go("client"), "quiet");
    const advanced = this.element(this.body!, "details", "cmt-advanced");
    this.element(advanced, "summary", "", "Local MCP settings");
    const endpoint = this.field(advanced, "Local endpoint", this.host.settings.mcpUrl, "http://127.0.0.1:8765/mcp", () => undefined);
    const token = this.field(advanced, "Local bearer token (optional)", this.draftToken, this.facts.token ? "Saved — leave blank to keep" : "Only if enabled in Vault as MCP", (value) => { this.draftToken = value; }, true);
    this.button(advanced, "Save local settings", () => void this.run("Saving…", async () => {
      await this.host.saveLocal(endpoint.getValue(), token.getValue());
      this.draftToken = ""; token.setValue("");
      this.facts = await this.host.inspect();
      this.showFeedback("Local settings saved.", false);
    }));
    if (this.facts.token) {
      this.button(advanced, "Remove local token", () => void this.run("Removing token…", async () => {
        await this.host.forgetToken(); this.facts.token = false; this.draftToken = ""; token.setValue("");
        this.showFeedback("Local token removed.", false);
      }), "quiet");
    }
    const path = this.element(advanced, "p", "cmt-help", "Client: ");
    this.element(path, "code", "cmt-path", this.host.settings.clientPath || "Not selected");
    const diagnostics = this.host.snapshot.dashboardUrl;
    if (diagnostics) this.link(advanced, "Open local diagnostics ↗", diagnostics);
    const remove = this.element(this.body!, "details", "cmt-advanced");
    this.element(remove, "summary", "", "Remove saved API key");
    this.element(remove, "p", "cmt-help", "Disconnects the tunnel and removes this Windows account's saved runtime key.");
    this.button(remove, "Remove key", () => void this.run("Removing key…", async () => {
      await this.host.forgetKey(); this.facts.key = false; this.go("account");
    })).setWarning();
  }

  private openPage(url: string): void {
    this.win.open(url, "_blank", "noopener,noreferrer");
  }

  private showFeedback(message: string, error: boolean): void {
    if (!this.root || !this.feedback) return;
    // No raw helper output is displayed here. Hosts return short, safe errors.
    this.feedback.textContent = message;
    this.feedback.hidden = !message;
    this.feedback.classList.toggle("is-error", error);
    this.feedback.setAttribute("role", error ? "alert" : "status");
    this.schedulePosition();
  }

  private async run(message: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const disabled = Array.from(this.root?.querySelectorAll<HTMLButtonElement>(".cmt-button") ?? []).map((button) => ({ button, wasDisabled: button.disabled }));
    disabled.forEach(({ button }) => { button.disabled = true; });
    this.showFeedback(message, false);
    try {
      await action();
      if (message && this.feedback?.textContent === message) this.showFeedback("", false);
    } catch (error) {
      this.showFeedback(error instanceof Error ? error.message : "Something went wrong. Try again.", true);
    } finally {
      this.busy = false;
      disabled.forEach(({ button, wasDisabled }) => { if (button.isConnected) button.disabled = wasDisabled; });
      this.updateConnection();
    }
  }
}

import { ButtonComponent, TextComponent, ToggleComponent, setIcon } from "obsidian";
import { isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { firstScreen, popoverPosition, statusCopy, type Screen, type SetupFacts } from "./ui-model";
import type { PopoverHost } from "./popover-host";

const URLS = {
  tunnels: "https://platform.openai.com/settings/organization/tunnels",
  keys: "https://platform.openai.com/settings/organization/api-keys",
  chatgpt: "https://chatgpt.com/#settings/Connectors",
  vault: "obsidian://show-plugin?id=vault-as-mcp",
};
let nextId = 0;

/** Click-open, non-modal surface. Keep the editor usable and active forms intact. */
export class ConnectionPopover {
  private root: HTMLDivElement | null = null;
  private body: HTMLElement | null = null;
  private feedback: HTMLElement | null = null;
  private screen: Screen = "loading";
  private facts: SetupFacts = { client: false, key: false, vault: "stopped", token: false };
  private disposers: Array<() => void> = [];
  private frame: number | null = null;
  private busy = false;
  private life = 0;
  private pendingInstall = false;
  private focusOnPosition = false;
  private draftId = "";
  private draftKey = "";
  private draftToken = "";
  private draftEndpoint = "";
  private replaceKey = false;
  private returnScreen: Screen = "home";
  private accountBack: Screen = "client";
  private statusUpdater: (() => void) | null = null;
  private validator: (() => void) | null = null;
  private submit: ButtonComponent | null = null;
  private buttons = new Map<HTMLButtonElement, boolean>();
  private readonly doc: Document;
  private readonly win: Window;

  constructor(private readonly anchor: HTMLElement, private readonly host: PopoverHost, private readonly onClose: () => void) {
    this.doc = anchor.ownerDocument; this.win = this.doc.defaultView!;
  }
  get isOpen(): boolean { return this.root !== null; }
  open(): void {
    if (this.root) return;
    ++this.life; this.busy = false; this.screen = "loading";
    this.draftId = this.host.settings.tunnelId; this.draftEndpoint = this.host.settings.mcpUrl;
    this.replaceKey = false; this.pendingInstall = this.host.installing;
    this.focusOnPosition = true;
    const root = this.doc.createElement("div");
    root.className = "cmt-popover"; root.id = `cmt-popover-${++nextId}`;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-label", "ChatGPT MCP Tunnel"); root.tabIndex = -1;
    this.root = root; root.style.visibility = "hidden"; this.doc.body.appendChild(root);
    if (typeof root.showPopover === "function") {
      root.setAttribute("popover", "manual"); root.showPopover();
    }
    this.anchor.setAttribute("aria-expanded", "true"); this.anchor.setAttribute("aria-controls", root.id);
    this.listen(this.doc, "pointerdown", (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(root) && !path.includes(this.anchor)) this.close(false);
    }, true);
    this.listen(this.doc, "keydown", (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Escape" && !key.isComposing) {
        key.preventDefault(); key.stopPropagation(); this.close(true);
      } else if (key.key === "Enter" && !key.isComposing && !key.repeat &&
        !key.ctrlKey && !key.metaKey && !key.altKey &&
        root.contains(key.target as Node) && (key.target as HTMLElement).tagName === "INPUT" &&
        this.submit && !this.submit.buttonEl.disabled) {
        key.preventDefault(); this.submit.buttonEl.click();
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
    this.render(); root.focus({ preventScroll: true }); void this.load();
  }
  close(restoreFocus = false): void {
    const root = this.root;
    if (!root) return;
    ++this.life; this.root = null; this.body = null; this.feedback = null;
    this.statusUpdater = null; this.validator = null; this.submit = null; this.buttons.clear();
    this.disposers.splice(0).forEach((dispose) => dispose());
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null; this.draftKey = ""; this.draftToken = ""; this.replaceKey = false;
    root.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => { input.value = ""; });
    root.remove(); this.anchor.setAttribute("aria-expanded", "false"); this.anchor.removeAttribute("aria-controls");
    if (restoreFocus && this.anchor.isConnected) this.anchor.focus({ preventScroll: true });
    this.onClose();
  }
  updateConnection(): void {
    if (!this.root) return;
    if (this.pendingInstall && !this.host.installing && !this.busy && this.screen === "client") {
      this.pendingInstall = false; void this.load(); return;
    }
    this.pendingInstall = this.host.installing;
    this.statusUpdater?.(); this.syncControls(); this.schedulePosition();
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
      this.root.style.left = `${p.left}px`; this.root.style.top = `${p.top}px`; this.root.style.visibility = "";
      if (this.focusOnPosition) { this.focusOnPosition = false; this.root.focus({ preventScroll: true }); }
    });
  }
  private async load(): Promise<void> {
    const life = this.life;
    try {
      const facts = await this.host.inspect();
      if (!this.root || life !== this.life) return;
      this.facts = facts;
      this.go(firstScreen(facts, isValidTunnelId(this.host.settings.tunnelId), !!this.host.settings.chatgptLinked));
    } catch {
      if (!this.root || life !== this.life) return;
      this.go("client"); this.showFeedback("Couldn't check the local connection. Check again or choose your client file.", true);
    }
  }
  private go(screen: Screen, focus = false): void {
    this.screen = screen; this.render();
    if (focus) this.root?.querySelector<HTMLElement>(".cmt-title")?.focus({ preventScroll: true });
  }
  private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag); node.className = cls;
    if (text) node.textContent = text; parent.appendChild(node); return node;
  }
  private disable(button: ButtonComponent, value: boolean): void {
    this.buttons.set(button.buttonEl, value); this.syncControls();
  }
  private syncControls(): void {
    for (const [button, invalid] of this.buttons) {
      button.disabled = invalid || (this.busy && button.dataset.allowBusy !== "true");
    }
    this.root?.setAttribute("aria-busy", String(this.busy));
  }
  private button(parent: HTMLElement, label: string, action: () => void, kind = "secondary"): ButtonComponent {
    const button = new ButtonComponent(parent).setButtonText(label).onClick(action);
    button.buttonEl.type = "button"; button.buttonEl.classList.add("cmt-button", `cmt-${kind}`);
    if (kind === "primary") button.setCta();
    this.buttons.set(button.buttonEl, false); return button;
  }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void, allowBusy = false): ButtonComponent {
    const button = new ButtonComponent(parent).setIcon(icon).setTooltip(label).onClick(action);
    button.buttonEl.type = "button"; button.buttonEl.classList.add("cmt-icon-button");
    button.buttonEl.setAttribute("aria-label", label);
    if (allowBusy) button.buttonEl.dataset.allowBusy = "true";
    this.buttons.set(button.buttonEl, false); return button;
  }
  private link(parent: HTMLElement, label: string, url: string): void {
    const link = this.element(parent, "a", "cmt-link", label);
    link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
  }
  private heading(step: number | null, title: string, description: string): void {
    if (step !== null) {
      const progress = this.element(this.body!, "div", "cmt-progress");
      progress.setAttribute("aria-label", `Setup step ${step} of 3`);
      for (let i = 1; i <= 3; i++) {
        const mark = this.element(progress, "span", i <= step ? "is-complete" : "");
        mark.setAttribute("aria-hidden", "true");
      }
      this.element(this.body!, "div", "cmt-eyebrow", `STEP ${step} OF 3`);
    }
    const h = this.element(this.body!, "h3", "cmt-title", title); h.tabIndex = -1;
    this.element(this.body!, "p", "cmt-description", description);
  }
  private row(parent: HTMLElement, label: string, value: string, ok: boolean): void {
    const row = this.element(parent, "div", "cmt-check-row");
    const icon = this.element(row, "span", ok ? "cmt-check is-ok" : "cmt-check");
    setIcon(icon, ok ? "check" : "minus"); icon.setAttribute("aria-hidden", "true");
    this.element(row, "span", "cmt-check-label", label); this.element(row, "span", "cmt-muted", value);
  }
  private field(parent: HTMLElement, label: string, value: string, placeholder: string, change: (value: string) => void, secret = false): TextComponent {
    const wrap = this.element(parent, "div", "cmt-field");
    const labelEl = this.element(wrap, "label", "cmt-label", label);
    const inputWrap = this.element(wrap, "div", "cmt-input-wrap");
    const input = new TextComponent(inputWrap).setValue(value).setPlaceholder(placeholder).onChange(change);
    input.inputEl.id = `cmt-field-${++nextId}`; labelEl.htmlFor = input.inputEl.id;
    input.inputEl.spellcheck = false; input.inputEl.autocomplete = "off";
    if (secret) {
      input.inputEl.type = "password"; input.inputEl.dataset.secret = "true";
      const reveal = this.iconButton(inputWrap, "eye", `Show ${label.toLowerCase()}`, () => {
        const visible = input.inputEl.type === "password";
        input.inputEl.type = visible ? "text" : "password";
        reveal.setIcon(visible ? "eye-off" : "eye");
        reveal.buttonEl.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`);
        reveal.buttonEl.setAttribute("aria-pressed", String(visible));
      });
      reveal.buttonEl.setAttribute("aria-pressed", "false");
    }
    return input;
  }
  private render(): void {
    const root = this.root; if (!root) return;
    this.statusUpdater = null; this.validator = null; this.submit = null; this.buttons.clear();
    root.replaceChildren(); root.dataset.screen = this.screen;
    const header = this.element(root, "header", "cmt-header");
    if (this.screen === "settings" || this.screen === "account") {
      this.iconButton(header, "arrow-left", "Back", () => this.go(this.screen === "settings" ? this.returnScreen : this.accountBack, true));
    } else { const icon = this.element(header, "span", "cmt-brand-icon"); setIcon(icon, "plug-zap"); }
    const brand = this.element(header, "div", "cmt-brand");
    this.element(brand, "strong", "", "ChatGPT"); this.element(brand, "span", "cmt-muted", "MCP connection");
    if (this.screen !== "settings" && this.screen !== "loading") {
      this.iconButton(header, "settings-2", "Connection settings", () => { this.returnScreen = this.screen; this.go("settings", true); });
    }
    this.iconButton(header, "x", "Close", () => this.close(true), true);
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
    this.feedback.setAttribute("role", "status"); this.feedback.setAttribute("aria-live", "polite"); this.feedback.hidden = true;
    this.syncControls(); this.schedulePosition();
  }
  private renderClient(): void {
    this.heading(1, "Connect this vault", "Use the OpenAI client you already have, or install it here.");
    const checks = this.element(this.body!, "div", "cmt-checks");
    this.row(checks, "Vault as MCP", this.facts.vault === "running" ? "Running" : this.facts.vault === "authentication" ? "Token needed" : "Not running", this.facts.vault === "running");
    this.row(checks, "OpenAI client", this.facts.client ? "Selected" : "Not selected", this.facts.client);
    if (this.facts.vault !== "running") {
      const help = this.element(this.body!, "p", "cmt-help");
      if (this.facts.vault === "authentication") {
        help.textContent = "Add the local bearer token in connection settings.";
      } else { help.textContent = "Start the local server first. "; this.link(help, "Open Vault as MCP ↗", URLS.vault); }
    }
    const actions = this.element(this.body!, "div", "cmt-actions");
    if (this.host.installing) {
      this.disable(this.button(actions, "Installing client…", () => undefined, "primary"), true);
      this.element(actions, "p", "cmt-help", "You can close this popover. Installation will continue."); return;
    }
    if (!this.facts.client) {
      this.button(actions, "Find existing client", () => void this.run("Looking in common folders…", async (live) => {
        const found = await this.host.findClient(); const facts = await this.host.inspect();
        if (!live()) return; this.facts = facts; this.render();
        if (!found) this.showFeedback("Not found in common folders. Choose tunnel-client.exe from its extracted folder.", false);
      }), "primary");
      const alternatives = this.element(actions, "div", "cmt-secondary-actions");
      this.button(alternatives, "Choose file", () => void this.run("Select tunnel-client.exe…", async (live) => {
        const chosen = await this.host.chooseClient(this.doc);
        if (chosen) { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } }
      }), "quiet");
      this.button(alternatives, "Install client", () => void this.run("Installing the official client…", async (live) => {
        await this.host.installClient((message) => { if (live()) this.showFeedback(message, false); });
        const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); }
      }), "quiet");
      this.element(actions, "p", "cmt-footnote", "Choose tunnel-client.exe, not cloudflared.exe.");
    } else {
      this.button(actions, this.facts.vault === "running" ? "Continue" : "Check again", () => {
        if (this.facts.vault !== "running") {
          void this.run("Checking the local server…", async (live) => { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } });
        } else this.go(this.facts.key && isValidTunnelId(this.host.settings.tunnelId) ? (this.host.settings.chatgptLinked ? "home" : "chatgpt") : "account", true);
      }, "primary");
      this.button(actions, "Use a different client", () => void this.run("Select tunnel-client.exe…", async (live) => {
        if (await this.host.chooseClient(this.doc)) { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } }
      }), "quiet");
    }
  }
  private renderAccount(): void {
    this.heading(2, "Your OpenAI connection", "Reuse your existing Tunnel ID and runtime API key.");
    const validate = (): void => {
      if (!this.submit) return;
      const needsKey = !this.facts.key || this.replaceKey;
      this.disable(this.submit, !isValidTunnelId(this.draftId) || (needsKey && this.draftKey.trim().length < 16));
    };
    const id = this.field(this.body!, "Tunnel ID", this.draftId, "tunnel_…", (value) => { this.draftId = value.trim(); validate(); });
    id.inputEl.addEventListener("blur", () => id.inputEl.setAttribute("aria-invalid", String(!!this.draftId && !isValidTunnelId(this.draftId))));
    const idHelp = this.element(this.body!, "p", "cmt-help"); this.link(idHelp, "Get a tunnel ID ↗", URLS.tunnels);
    if (this.facts.key && !this.replaceKey) {
      const saved = this.element(this.body!, "div", "cmt-saved");
      this.element(saved, "span", "", "API key saved securely");
      this.button(saved, "Replace", () => { this.replaceKey = true; this.render(); }, "quiet");
    } else {
      this.field(this.body!, "Runtime API key", this.draftKey, "Paste key once", (value) => { this.draftKey = value; validate(); }, true);
      if (this.facts.key) this.button(this.body!, "Keep saved key", () => { this.replaceKey = false; this.draftKey = ""; this.render(); }, "quiet");
    }
    const help = this.element(this.body!, "p", "cmt-help", "Permissions: Tunnels → Read + Use. "); this.link(help, "Create key ↗", URLS.keys);
    const actions = this.element(this.body!, "div", "cmt-actions");
    this.submit = this.button(actions, "Save & connect", () => void this.run("Saving connection…", async (live) => {
      const id = this.draftId, key = this.replaceKey || !this.facts.key ? this.draftKey : "";
      await this.host.saveAccount(id, key);
      // Dismissal closes only the UI, not an explicitly requested connection.
      const connecting = this.host.connect();
      if (live()) {
        this.draftKey = ""; this.replaceKey = false; this.facts.key = true;
        this.go(this.host.settings.chatgptLinked ? "home" : "chatgpt", true);
      }
      await connecting; if (live()) this.updateConnection();
    }), "primary");
    this.validator = validate; validate();
    this.element(actions, "p", "cmt-footnote", "Encrypted by Windows. Never stored in your vault.");
  }
  private renderChatgpt(): void {
    this.heading(3, "Finish in ChatGPT", "Add an MCP connection, choose Tunnel, and use this ID.");
    const copy = this.element(this.body!, "div", "cmt-copy-row");
    this.element(copy, "code", "", this.host.settings.tunnelId);
    this.iconButton(copy, "copy", "Copy Tunnel ID", () => void this.run("", async (live) => {
      await this.win.navigator.clipboard.writeText(this.host.settings.tunnelId);
      if (live()) this.showFeedback("Tunnel ID copied.", false);
    }));
    const status = this.element(this.body!, "p", "cmt-help"); status.setAttribute("role", "status");
    const actions = this.element(this.body!, "div", "cmt-actions");
    const open = this.button(actions, "Open ChatGPT ↗", () => this.openPage(URLS.chatgpt), "primary");
    const retry = this.button(actions, "Connect tunnel", () => {
      const s = this.host.snapshot;
      if (s.managed || s.state === "starting" || s.state === "connecting") this.host.disconnect();
      else void this.run("Connecting…", async (live) => { await this.host.connect(); if (live()) this.updateConnection(); });
    }, "quiet");
    retry.buttonEl.dataset.allowBusy = "true";
    this.button(actions, "I've already added this tunnel", () => void this.run("", async (live) => {
      await this.host.acknowledgeChatgpt(); if (live()) this.go("home", true);
    }), "quiet");
    this.statusUpdater = () => {
      const s = this.host.snapshot, ready = s.state === "connected";
      status.textContent = ready ? "Local tunnel ready. You can now add it in ChatGPT." : s.detail;
      status.classList.toggle("is-error", s.state === "error");
      // Checking ChatGPT settings must remain available even when the local
      // tunnel is temporarily offline; connector registration still needs readiness.
      retry.buttonEl.hidden = ready;
      retry.setButtonText(s.state === "starting" || s.state === "connecting" ? "Cancel connection" : s.state === "stopping" ? "Stopping…" : "Connect tunnel");
      this.disable(retry, s.state === "stopping");
    }; this.statusUpdater();
  }
  private renderHome(): void {
    const hero = this.element(this.body!, "div", "cmt-status-heading");
    const icon = this.element(hero, "span", "cmt-state-icon");
    const title = this.element(hero, "h3", "cmt-title"); title.tabIndex = -1;
    const detail = this.element(this.body!, "p", "cmt-description"); detail.setAttribute("role", "status");
    const checks = this.element(this.body!, "div", "cmt-checks");
    const retryInfo = this.element(this.body!, "p", "cmt-help");
    const actions = this.element(this.body!, "div", "cmt-actions");
    const action = this.button(actions, "Connect", () => {
      const s = this.host.snapshot;
      if (s.managed || s.state === "starting" || s.state === "connecting") { this.host.disconnect(); return; }
      void this.run("", async (live) => {
        if (this.host.snapshot.state === "not-configured") await this.load();
        else await this.host.connect();
        if (live()) this.updateConnection();
      });
    }, "primary");
    action.buttonEl.dataset.allowBusy = "true";
    const edit = this.button(actions, "Review connection details", () => { this.accountBack = "home"; this.go("account", true); }, "quiet");
    const footer = this.element(actions, "p", "cmt-footnote"); this.link(footer, "Open ChatGPT ↗", URLS.chatgpt);
    let previous = "";
    this.statusUpdater = () => {
      const s = this.host.snapshot, copy = statusCopy(s);
      title.textContent = copy.title; detail.textContent = copy.text;
      if (previous !== s.state) {
        previous = s.state; setIcon(icon, s.state === "connected" ? "check-circle-2" : s.state === "error" ? "circle-alert" : "plug-zap");
      }
      hero.dataset.state = s.state; action.setButtonText(copy.action);
      action.buttonEl.classList.toggle("mod-cta", !s.managed);
      this.disable(action, s.state === "stopping");
      edit.buttonEl.hidden = s.state !== "error" && s.state !== "not-configured";
      retryInfo.hidden = !s.retryAt; retryInfo.textContent = s.retryAt ? "Automatic retry scheduled. You can also retry now." : "";
      checks.replaceChildren();
      this.row(checks, "Local tunnel", s.state === "connected" ? "Ready" : s.state === "stopping" ? "Stopping" : s.managed ? "Starting" : "Stopped", s.state === "connected");
      this.row(checks, "Start with Obsidian", this.host.settings.autoConnect ? "On" : "Off", this.host.settings.autoConnect);
    }; this.statusUpdater();
  }
  private renderSettings(): void {
    this.heading(null, "Connection settings", "Keep the everyday connection simple. Adjust details here.");
    const auto = this.element(this.body!, "div", "cmt-preference");
    const label = this.element(auto, "label", "cmt-label", "Start with Obsidian");
    const toggle = new ToggleComponent(auto).setValue(this.host.settings.autoConnect).onChange((value) => {
      if (this.busy) { toggle.setValue(this.host.settings.autoConnect); return; }
      void this.run("", async () => { try { await this.host.setAutoConnect(value); } catch (error) { toggle.setValue(this.host.settings.autoConnect); throw error; } });
    });
    toggle.toggleEl.setAttribute("aria-label", label.textContent!);
    const links = this.element(this.body!, "div", "cmt-settings-actions");
    this.button(links, "Edit OpenAI details", () => { this.accountBack = "settings"; this.go("account", true); }, "quiet");
    this.button(links, "Change tunnel client", () => this.go("client", true), "quiet");
    const advanced = this.element(this.body!, "details", "cmt-advanced");
    this.element(advanced, "summary", "", "Local MCP settings");
    const endpoint = this.field(advanced, "Local endpoint", this.draftEndpoint, "http://127.0.0.1:8765/mcp", (value) => { this.draftEndpoint = value; });
    const token = this.field(advanced, "Local bearer token (optional)", this.draftToken, this.facts.token ? "Saved — leave blank to keep" : "Only if enabled in Vault as MCP", (value) => { this.draftToken = value; }, true);
    const save = this.button(advanced, "Save local settings", () => void this.run("Saving local settings…", async (live) => {
      if (!parseLocalMcpEndpoint(this.draftEndpoint)) throw new Error("Use a loopback HTTP address with a port and /mcp path.");
      await this.host.saveLocal(this.draftEndpoint, this.draftToken);
      const facts = await this.host.inspect(); if (!live()) return;
      this.facts = facts; this.draftToken = ""; token.setValue(""); this.showFeedback("Local settings saved.", false);
    }));
    endpoint.inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing && !this.busy) { event.preventDefault(); save.buttonEl.click(); } });
    if (this.facts.token) this.button(advanced, "Remove local token", () => void this.run("Removing token…", async (live) => {
      await this.host.forgetToken(); if (!live()) return;
      this.facts.token = false; this.draftToken = ""; token.setValue(""); this.showFeedback("Local token removed.", false);
    }), "quiet");
    const path = this.element(advanced, "p", "cmt-help", "Client: "); this.element(path, "code", "cmt-path", this.host.settings.clientPath || "Not selected");
    if (this.host.snapshot.dashboardUrl) this.link(advanced, "Open local diagnostics ↗", this.host.snapshot.dashboardUrl);
    const remove = this.element(this.body!, "details", "cmt-advanced"); this.element(remove, "summary", "", "Remove saved API key");
    this.element(remove, "p", "cmt-help", "Disconnects this tunnel and removes the saved runtime key.");
    this.button(remove, "Remove key", () => void this.run("Removing key…", async (live) => {
      await this.host.forgetKey(); if (!live()) return;
      this.facts.key = false; this.draftKey = ""; this.replaceKey = false; this.accountBack = "settings"; this.go("account", true);
    })).setWarning();
  }
  private openPage(url: string): void { this.win.open(url, "_blank", "noopener,noreferrer"); }
  private showFeedback(message: string, error: boolean): void {
    if (!this.root || !this.feedback) return;
    this.feedback.textContent = message; this.feedback.hidden = !message;
    this.feedback.classList.toggle("is-error", error); this.feedback.setAttribute("role", error ? "alert" : "status");
    this.schedulePosition();
  }
  private async run(message: string, action: (live: () => boolean) => Promise<void>): Promise<void> {
    if (this.busy || !this.root) return;
    const life = this.life; const live = (): boolean => this.root !== null && life === this.life;
    this.busy = true; this.syncControls(); this.showFeedback(message, false);
    try {
      await action(live);
      if (live() && message && this.feedback?.textContent === message) this.showFeedback("", false);
    } catch (error) {
      if (live()) this.showFeedback(error instanceof Error ? error.message : "Something went wrong. Try again.", true);
    } finally {
      if (live()) { this.busy = false; this.validator?.(); this.updateConnection(); }
    }
  }
}

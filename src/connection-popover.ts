import { ButtonComponent, TextComponent, ToggleComponent, setIcon } from "obsidian";
import { isValidTunnelId, parseLocalMcpEndpoint } from "./validation";
import { firstScreen, popoverPosition, statusCopy, type Screen, type SetupFacts } from "./ui-model";
import type { PopoverHost } from "./popover-host";
import { SETUP_URLS as URLS, CHATGPT_TEST_PROMPT } from "./setup-guide";
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
  private clientBack: Screen | null = null;
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
    this.clientBack = null;
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
      if (this.root.style.left !== `${p.left}px`) this.root.style.left = `${p.left}px`;
      if (this.root.style.top !== `${p.top}px`) this.root.style.top = `${p.top}px`;
      if (this.root.style.visibility) this.root.style.visibility = "";
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
      this.go("client"); this.showFeedback("No se pudo comprobar la conexión. Reintenta o selecciona el cliente local.", true);
    }
  }
  private go(screen: Screen, focus = false): void {
    this.screen = screen; this.render();
    if (focus) (this.root?.querySelector<HTMLElement>(".cmt-title") ?? this.root?.querySelector<HTMLElement>(".cmt-brand strong"))?.focus({ preventScroll: true });
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
      const disabled = invalid || (this.busy && button.dataset.allowBusy !== "true");
      if (button.disabled !== disabled) button.disabled = disabled;
    }
    if (this.root?.getAttribute("aria-busy") !== String(this.busy)) this.root?.setAttribute("aria-busy", String(this.busy));
  }
  private button(parent: HTMLElement, label: string, action: () => void, kind = "secondary"): ButtonComponent {
    const button = new ButtonComponent(parent).setButtonText(label).onClick(action);
    button.buttonEl.type = "button"; button.buttonEl.classList.add("cmt-button", `cmt-${kind}`);
    this.buttons.set(button.buttonEl, false); return button;
  }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void, allowBusy = false): ButtonComponent {
    const button = new ButtonComponent(parent).setIcon(icon).setTooltip(label).onClick(action);
    button.buttonEl.type = "button"; button.buttonEl.classList.add("cmt-icon-button", "clickable-icon");
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
      this.element(this.body!, "p", "cmt-step", `Paso ${step} de 3`);
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
      const reveal = this.iconButton(inputWrap, "eye", `Mostrar ${label.toLowerCase()}`, () => {
        const visible = input.inputEl.type === "password";
        input.inputEl.type = visible ? "text" : "password";
        reveal.setIcon(visible ? "eye-off" : "eye");
        reveal.buttonEl.setAttribute("aria-label", `${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`);
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
    if (this.screen === "settings" || this.screen === "account" || this.screen === "chatgpt" || (this.screen === "client" && this.clientBack)) {
      this.iconButton(header, "arrow-left", "Volver", () => this.go(this.screen === "settings" ? this.returnScreen : this.screen === "client" ? this.clientBack! : this.screen === "chatgpt" ? (this.host.settings.chatgptLinked ? "home" : "account") : this.accountBack, true));
    }
    const brand = this.element(header, "div", "cmt-brand");
    this.element(brand, "strong", "", this.screen === "settings" ? "Opciones" : "ChatGPT").tabIndex = -1;
    if (this.screen !== "settings" && this.screen !== "loading") {
      this.iconButton(header, "settings-2", "Opciones", () => { this.returnScreen = this.screen; this.go("settings", true); });
    }
    this.iconButton(header, "x", "Cerrar", () => this.close(true), true);
    this.body = this.element(root, "div", "cmt-body");
    switch (this.screen) {
      case "loading": this.element(this.body, "p", "cmt-description", "Comprobando conexión…"); break;
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
    this.heading(1, "Conexión local", "Prepara el cliente local y Vault as MCP para conectar esta bóveda.");
    const checks = this.element(this.body!, "div", "cmt-checks");
    this.row(checks, "Vault as MCP", this.facts.vault === "running" ? "Activo" : this.facts.vault === "authentication" ? "Falta el token" : this.facts.vault === "missing" ? "Sin instalar" : this.facts.vault === "missing-tools" ? "Faltan herramientas" : this.facts.vault === "unexpected-server" ? "Revisar dirección" : "Detenido", this.facts.vault === "running");
    this.row(checks, "Cliente local", this.facts.client ? "Seleccionado" : "Sin seleccionar", this.facts.client);
    if (this.facts.vault !== "running") {
      const help = this.element(this.body!, "p", "cmt-help");
      if (this.facts.vault === "authentication") {
        help.textContent = "Añade el token local en Opciones.";
      } else if (this.facts.vault === "missing") {
        help.textContent = "Instala y activa Vault as MCP. "; this.link(help, "Instalar Vault as MCP", URLS.vault);
      } else {
        help.textContent = this.facts.vault === "missing-tools" ? "Actualiza o reinicia Vault as MCP para recuperar sus herramientas. " : "Podemos iniciar el servidor local. ";
        this.link(help, "Abrir Vault as MCP", URLS.vault);
      }
    }
    const actions = this.element(this.body!, "div", "cmt-actions");
    if (this.host.installing) {
      this.disable(this.button(actions, "Instalando cliente…", () => undefined, "primary"), true);
      this.element(actions, "p", "cmt-help", "Puedes cerrar el panel. La instalación continúa."); return;
    }
    if (!this.facts.client || this.facts.vault !== "running") {
      this.button(actions, "Preparar conexión", () => void this.run("Preparando conexión…", async (live) => {
        await this.host.prepareLocal(message => { if (live()) this.showFeedback(message, false); });
        if (live()) await this.load();
      }), "primary");
    }
    if (!this.facts.client) {
      const choice = this.element(actions, "details", "cmt-advanced cmt-client-choice");
      this.element(choice, "summary", "", "Elegir cliente");
      this.button(choice, "Buscar cliente", () => void this.run("Buscando cliente…", async (live) => {
        const found = await this.host.findClient(); const facts = await this.host.inspect();
        if (!live()) return; this.facts = facts; this.render();
        if (!found) this.showFeedback("Selecciona tunnel-client.exe desde la carpeta donde lo descargaste.", false);
      }), "quiet");
      const alternatives = this.element(choice, "div", "cmt-secondary-actions");
      this.button(alternatives, "Seleccionar archivo", () => void this.run("Selecciona tunnel-client.exe…", async (live) => {
        const chosen = await this.host.chooseClient(this.doc);
        if (chosen) { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } }
      }), "quiet");
      this.button(alternatives, "Instalar cliente", () => void this.run("Instalando cliente oficial…", async (live) => {
        await this.host.installClient((message) => { if (live()) this.showFeedback(message, false); });
        const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); }
      }), "quiet");
      this.element(choice, "p", "cmt-footnote", "Selecciona tunnel-client.exe, no cloudflared.exe. El cliente se guarda junto al plugin; las claves quedan cifradas fuera de la bóveda.");
    } else {
      this.button(actions, this.facts.vault === "running" ? "Continuar" : "Comprobar", () => {
        if (this.facts.vault !== "running") {
          void this.run("Comprobando servidor local…", async (live) => { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } });
        } else this.go(this.facts.key && isValidTunnelId(this.host.settings.tunnelId) ? (this.host.settings.chatgptLinked ? "home" : "chatgpt") : "account", true);
      }, this.facts.vault === "running" ? "primary" : "quiet");
      this.button(actions, "Cambiar cliente", () => void this.run("Selecciona tunnel-client.exe…", async (live) => {
        if (await this.host.chooseClient(this.doc)) { const facts = await this.host.inspect(); if (live()) { this.facts = facts; this.render(); } }
      }), "quiet");
    }
  }
  private renderAccount(): void {
    this.heading(2, "Conexión de OpenAI", "Abre los enlaces para obtener el ID del túnel y su clave. Solo necesitas configurarlos una vez.");
    const validate = (): void => {
      if (!this.submit) return;
      const needsKey = !this.facts.key || this.replaceKey;
      this.disable(this.submit, !isValidTunnelId(this.draftId) || (needsKey && this.draftKey.trim().length < 16));
    };
    const id = this.field(this.body!, "ID del túnel", this.draftId, "tunnel_…", (value) => { this.draftId = value.trim(); validate(); });
    id.inputEl.addEventListener("blur", () => id.inputEl.setAttribute("aria-invalid", String(!!this.draftId && !isValidTunnelId(this.draftId))));
    const idHelp = this.element(this.body!, "p", "cmt-help"); this.link(idHelp, "Crear o abrir túnel", URLS.tunnels);
    idHelp.appendChild(this.doc.createTextNode(" Asócialo al espacio de ChatGPT que usarás y copia su ID."));
    if (this.facts.key && !this.replaceKey) {
      const saved = this.element(this.body!, "div", "cmt-saved");
      this.element(saved, "span", "", "Clave guardada");
      this.button(saved, "Cambiar", () => { this.replaceKey = true; this.render(); }, "quiet");
    } else {
      this.field(this.body!, "Clave de OpenAI", this.draftKey, "Pegar clave", (value) => { this.draftKey = value; validate(); }, true);
      if (this.facts.key) this.button(this.body!, "Conservar clave", () => { this.replaceKey = false; this.draftKey = ""; this.render(); }, "quiet");
    }
    const help = this.element(this.body!, "p", "cmt-help"); this.link(help, "Crear clave", URLS.keys);
    help.appendChild(this.doc.createTextNode(" Usa la misma organización. Selecciona Restricted y Tunnels → Read + Use. Copia la clave antes de cerrar la página."));
    const guide = this.element(this.body!, "p", "cmt-help"); this.link(guide, "Guía de OpenAI", URLS.guide);
    const actions = this.element(this.body!, "div", "cmt-actions");
    this.submit = this.button(actions, "Guardar y conectar", () => void this.run("Guardando conexión…", async (live) => {
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
    this.element(actions, "p", "cmt-footnote", "La clave queda cifrada por Windows, fuera de la bóveda.");
  }
  private renderChatgpt(): void {
    this.heading(3, "Configurar ChatGPT", "En ChatGPT, abre Plugins → + → Add custom MCP server. Usa el nombre Obsidian, elige Tunnel y pega este ID.");
    const copy = this.element(this.body!, "div", "cmt-copy-row");
    this.element(copy, "code", "", this.host.settings.tunnelId);
    this.iconButton(copy, "copy", "Copiar ID", () => void this.run("", async (live) => {
      await this.win.navigator.clipboard.writeText(this.host.settings.tunnelId);
      if (live()) this.showFeedback("ID copiado.", false);
    }));
    const status = this.element(this.body!, "p", "cmt-help"); status.setAttribute("role", "status");
    const actions = this.element(this.body!, "div", "cmt-actions");
    this.button(actions, "Abrir ChatGPT", () => this.openPage(URLS.chatgpt), "primary");
    this.element(actions, "p", "cmt-help", "Elige No authentication: el puente gestiona el token local. Crea e instala el plugin, abre un chat nuevo y selecciona @Obsidian.");
    this.button(actions, "Copiar prueba", () => void this.run("", async (live) => {
      await this.win.navigator.clipboard.writeText(CHATGPT_TEST_PROMPT);
      if (live()) this.showFeedback("Prueba copiada. Pégala en ChatGPT para comprobar la lectura sin cambiar notas.", false);
    }), "quiet");
    const troubleshooting = this.element(actions, "details", "cmt-advanced");
    this.element(troubleshooting, "summary", "", "¿No aparece el túnel?");
    this.element(troubleshooting, "p", "cmt-help", "Usa la cuenta y el espacio de ChatGPT asociados al túnel, con permisos Tunnels → Read + Use. Mantén Obsidian abierto.");
    this.link(troubleshooting, "Revisar túnel", URLS.tunnels);
    const retry = this.button(actions, "Conectar", () => {
      const s = this.host.snapshot;
      if (s.managed || s.state === "starting" || s.state === "connecting") this.host.disconnect();
      else void this.run("Conectando…", async (live) => { await this.host.connect(); if (live()) this.updateConnection(); });
    }, "quiet");
    retry.buttonEl.dataset.allowBusy = "true";
    this.button(actions, "Ya lo añadí", () => void this.run("", async (live) => {
      await this.host.acknowledgeChatgpt(); if (live()) this.go("home", true);
    }), "quiet");
    this.element(actions, "p", "cmt-footnote", "Este botón guarda tu confirmación. Ejecuta la prueba en ChatGPT para verificar el acceso.");
    this.statusUpdater = () => {
      const s = this.host.snapshot, ready = s.state === "connected";
      status.textContent = ready ? "El puente local está disponible. Añade el plugin en ChatGPT y ejecuta la prueba." : s.detail;
      status.classList.toggle("is-error", s.state === "error");
      // Checking ChatGPT settings must remain available even when the local
      // tunnel is temporarily offline; connector registration still needs readiness.
      retry.buttonEl.hidden = ready;
      retry.setButtonText(s.state === "starting" || s.state === "connecting" ? "Cancelar" : s.state === "stopping" ? "Desconectando…" : "Conectar");
      this.disable(retry, s.state === "stopping");
    }; this.statusUpdater();
  }
  private renderHome(): void {
    const line = this.element(this.body!, "div", "cmt-source-line");
    this.element(line, "strong", "", "Conexión local");
    const title = this.element(line, "span", "cmt-source-status cmt-title"); title.tabIndex = -1;
    const detail = this.element(this.body!, "p", "cmt-description"); detail.setAttribute("role", "status");
    const retryInfo = this.element(this.body!, "p", "cmt-help");
    const actions = this.element(this.body!, "div", "cmt-actions");
    const action = this.button(actions, "Conectar", () => {
      const s = this.host.snapshot;
      if (s.state === "connected") { this.openPage(URLS.chat); return; }
      if (s.managed || s.state === "starting" || s.state === "connecting") { this.host.disconnect(); return; }
      void this.run("", async (live) => {
        if (this.host.snapshot.state === "not-configured") await this.load();
        else await this.host.connect();
        if (live()) this.updateConnection();
      });
    }, "primary");
    action.buttonEl.dataset.allowBusy = "true";
    const test = this.button(this.body!, "Probar en ChatGPT", () => this.go("chatgpt", true), "nav");
    const chevron = this.element(test.buttonEl, "span", "cmt-chevron"); setIcon(chevron, "chevron-right");
    let previous = "";
    this.statusUpdater = () => {
      const s = this.host.snapshot, copy = statusCopy(s);
      const key = JSON.stringify([s, this.host.settings.autoConnect, this.host.settings.chatgptLinked]);
      if (previous === key) return;
      previous = key;
      title.textContent = copy.title; detail.textContent = copy.text;
      line.dataset.state = s.state; action.setButtonText(copy.action);
      this.disable(action, s.state === "stopping");
      retryInfo.hidden = !s.retryAt; retryInfo.textContent = s.retryAt ? "Se reintentará automáticamente. También puedes reintentar ahora." : "";
    }; this.statusUpdater();
  }
  private renderSettings(): void {
    const auto = this.element(this.body!, "div", "cmt-preference");
    const label = this.element(auto, "label", "cmt-label", "Iniciar con Obsidian");
    const toggle = new ToggleComponent(auto).setValue(this.host.settings.autoConnect).onChange((value) => {
      if (this.busy) { toggle.setValue(this.host.settings.autoConnect); return; }
      void this.run("", async () => { try { await this.host.setAutoConnect(value); } catch (error) { toggle.setValue(this.host.settings.autoConnect); throw error; } });
    });
    toggle.toggleEl.setAttribute("aria-label", label.textContent!);
    const links = this.element(this.body!, "div", "cmt-settings-actions");
    this.button(links, "Datos de conexión", () => { this.accountBack = "settings"; this.go("account", true); }, "quiet");
    this.button(links, "Cliente local", () => { this.clientBack = "settings"; this.go("client", true); }, "quiet");
    this.button(links, "Reparar conexión", () => void this.run("Comprobando conexión local…", async (live) => {
      await this.host.prepareLocal(message => { if (live()) this.showFeedback(message, false); });
      if (live()) await this.load();
    }), "quiet");
    const disconnect = this.button(links, "Desconectar", () => this.host.disconnect(), "quiet");
    disconnect.buttonEl.dataset.allowBusy = "true";
    const advanced = this.element(this.body!, "details", "cmt-advanced");
    this.element(advanced, "summary", "", "MCP local");
    this.element(advanced, "p", "cmt-help", this.host.settings.autoDetectLocal ? "La dirección y el token se detectan desde Vault as MCP. Si guardas otros valores, se usarán tus ajustes manuales." : "Estás usando ajustes manuales. Puedes volver a la detección automática.");
    this.button(advanced, "Detectar automáticamente", () => void this.run("Detectando Vault as MCP…", async (live) => {
      await this.host.useAutomaticLocal();
      if (live()) { this.draftEndpoint = this.host.settings.mcpUrl; this.facts = await this.host.inspect(); if (live()) this.render(); }
    }), "quiet");
    const endpoint = this.field(advanced, "Dirección local", this.draftEndpoint, "http://127.0.0.1:8765/mcp", (value) => { this.draftEndpoint = value; });
    const token = this.field(advanced, "Token local (opcional)", this.draftToken, this.facts.token ? "Guardado; deja vacío para conservarlo" : "Solo si Vault as MCP lo requiere", (value) => { this.draftToken = value; }, true);
    const save = this.button(advanced, "Guardar ajustes", () => void this.run("Guardando ajustes…", async (live) => {
      if (!parseLocalMcpEndpoint(this.draftEndpoint)) throw new Error("Usa una dirección HTTP local con puerto y ruta /mcp.");
      await this.host.saveLocal(this.draftEndpoint, this.draftToken);
      const facts = await this.host.inspect(); if (!live()) return;
      this.facts = facts; this.draftToken = ""; token.setValue(""); this.showFeedback("Ajustes guardados.", false);
    }));
    endpoint.inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing && !this.busy) { event.preventDefault(); save.buttonEl.click(); } });
    if (this.facts.token) this.button(advanced, "Eliminar token local", () => void this.run("Eliminando token…", async (live) => {
      await this.host.forgetToken(); if (!live()) return;
      this.facts.token = false; this.draftToken = ""; token.setValue(""); this.showFeedback("Token eliminado.", false);
    }), "quiet");
    const path = this.element(advanced, "p", "cmt-help", "Cliente: "); this.element(path, "code", "cmt-path", this.host.settings.clientPath || "Sin seleccionar");
    if (this.host.snapshot.dashboardUrl) this.link(advanced, "Abrir diagnóstico local", this.host.snapshot.dashboardUrl);
    const diagnostics = this.element(this.body!, "details", "cmt-advanced"); this.element(diagnostics, "summary", "", "Diagnóstico");
    const checks = this.element(diagnostics, "div", "cmt-checks");
    const report = this.element(diagnostics, "p", "cmt-help");
    let previous = "";
    this.statusUpdater = () => {
      const s = this.host.snapshot, key = JSON.stringify([s, this.facts, this.host.settings.autoConnect, this.host.settings.chatgptLinked]);
      if (previous === key) return; previous = key;
      disconnect.buttonEl.hidden = !s.managed && s.state !== "starting" && s.state !== "connecting";
      this.disable(disconnect, s.state === "stopping");
      report.textContent = s.detail; checks.replaceChildren();
      this.row(checks, "Túnel local", statusCopy(s).title, s.state === "connected");
      this.row(checks, "Herramientas MCP", s.state === "connected" && this.facts.toolCount ? String(this.facts.toolCount) : "Por comprobar", s.state === "connected" && !!this.facts.toolCount);
      this.row(checks, "ChatGPT", this.host.settings.chatgptLinked ? "Marcado como añadido" : "Sin configurar", !!this.host.settings.chatgptLinked);
      this.row(checks, "Iniciar con Obsidian", this.host.settings.autoConnect ? "Activado" : "Desactivado", this.host.settings.autoConnect);
    }; this.statusUpdater();
    const remove = this.element(this.body!, "details", "cmt-advanced"); this.element(remove, "summary", "", "Eliminar clave de OpenAI");
    this.element(remove, "p", "cmt-help", "Desconecta el túnel y elimina la clave guardada.");
    this.button(remove, "Eliminar clave", () => void this.run("Eliminando clave…", async (live) => {
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
      if (live()) this.showFeedback(error instanceof Error ? error.message : "No se pudo completar la acción. Vuelve a intentarlo.", true);
    } finally {
      if (live()) { this.busy = false; this.validator?.(); this.updateConnection(); }
    }
  }
}

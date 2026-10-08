/** DOM-only Obsidian doubles. Production imports the application's real API. */
export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) { this.buttonEl = parent.ownerDocument.createElement("button"); parent.appendChild(this.buttonEl); }
  setButtonText(value: string) { this.buttonEl.textContent = value; return this; }
  onClick(action: () => void) { this.buttonEl.addEventListener("click", action); return this; }
  setCta() { this.buttonEl.classList.add("mod-cta"); return this; }
  setWarning() { this.buttonEl.classList.add("mod-warning"); return this; }
  setDisabled(value: boolean) { this.buttonEl.disabled = value; return this; }
  setIcon(value: string) { setIcon(this.buttonEl, value); return this; }
  setTooltip(value: string) { this.buttonEl.title = value; return this; }
}
export class TextComponent {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.inputEl = parent.ownerDocument.createElement("input"); this.inputEl.type = "text"; parent.appendChild(this.inputEl); }
  setValue(value: string) { this.inputEl.value = value; return this; }
  getValue() { return this.inputEl.value; }
  setPlaceholder(value: string) { this.inputEl.placeholder = value; return this; }
  onChange(action: (value: string) => void) { this.inputEl.addEventListener("input", () => action(this.inputEl.value)); return this; }
}
export class ToggleComponent {
  toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.toggleEl = parent.ownerDocument.createElement("input"); this.toggleEl.type = "checkbox"; parent.appendChild(this.toggleEl); }
  setValue(value: boolean) { this.toggleEl.checked = value; return this; }
  onChange(action: (value: boolean) => void) { this.toggleEl.addEventListener("change", () => action(this.toggleEl.checked)); return this; }
}
export function setIcon(element: HTMLElement, name: string) {
  element.replaceChildren();
  const svg = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths: Record<string, string> = {
    check: "m5 12 4 4L19 6", minus: "M5 12h14", x: "m6 6 12 12M6 18 18 6", "arrow-left": "m12 5-7 7 7 7M5 12h14",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4", "settings-2": "M4 5h16M4 12h16M4 19h16M9 3v4M15 10v4M8 17v4",
    "plug-zap": "M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M7 8v3a5 5 0 0 0 5 5M20 3l-2 3h4l-2 3",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
    "eye-off": "M3 3l18 18M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12",
    "check-circle-2": "M22 11A10 10 0 1 1 12 2M9 11l3 3L22 4",
    "circle-alert": "M12 8v5m0 3v.1M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0",
  };
  path.setAttribute("d", paths[name] || paths.minus); svg.appendChild(path); element.appendChild(svg);
}

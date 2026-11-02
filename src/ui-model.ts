import type { ConnectionSnapshot } from "./types";
export type Screen = "loading" | "client" | "account" | "chatgpt" | "home" | "settings";
export interface SetupFacts { client: boolean; key: boolean; vault: "running" | "stopped" | "missing" | "authentication" | "missing-tools" | "unexpected-server"; token: boolean; toolCount?: number; writable?: boolean }
export function firstScreen(facts: SetupFacts, validId: boolean, linked: boolean): Screen {
  // A previously configured connection needs recovery, not the first-run wizard.
  if (facts.client && facts.key && validId && linked && facts.vault === "stopped") return "home";
  if (!facts.client || facts.vault !== "running") return "client";
  if (!facts.key || !validId) return "account";
  return linked ? "home" : "chatgpt";
}
export interface ConnectionCheck { label: string; value: string; tone: "ok" | "neutral" | "warning" | "error"; icon: string }
/** Only a monitored connected state marks both components ready. Setup facts are last-inspected evidence. */
export function connectionChecks(s: ConnectionSnapshot, facts: SetupFacts): { tunnel: ConnectionCheck; server: ConnectionCheck } {
  const check = (label: string, value: string, tone: ConnectionCheck["tone"] = "neutral", icon = "minus"): ConnectionCheck => ({label,value,tone,icon});
  let tunnel = check("Túnel local", "Desconectado");
  if (s.state === "connected" || (s.state === "waiting-for-obsidian" && s.managed)) tunnel = check("Túnel local", "Listo", "ok", "check");
  else if (s.state === "starting" || s.state === "connecting") tunnel = check("Túnel local", "Conectando…", "neutral", "loader-circle");
  else if (s.state === "stopping") tunnel = check("Túnel local", "Desconectando…");
  else if (s.state === "error") tunnel = check("Túnel local", "Error", "error", "circle-alert");
  else if (s.state === "existing-runtime") tunnel = check("Túnel local", "Otro cliente activo", "warning", "circle-alert");
  else if (s.state === "not-configured") tunnel = check("Túnel local", "Sin configurar");
  let server = check("Servidor MCP", "Por comprobar");
  if (s.state === "connected" && facts.vault === "running") server = check("Servidor MCP", "Listo", "ok", "check");
  else if (s.state === "waiting-for-obsidian") server = check("Servidor MCP", "No disponible", "warning", "circle-alert");
  else if (facts.vault === "running") server = check("Servidor MCP", "Detectado");
  else if (facts.vault === "missing") server = check("Servidor MCP", "Sin instalar", "warning", "circle-alert");
  else if (facts.vault === "authentication") server = check("Servidor MCP", "Requiere token", "warning", "circle-alert");
  else if (facts.vault === "missing-tools") server = check("Servidor MCP", "Faltan herramientas", "warning", "circle-alert");
  else if (facts.vault === "unexpected-server") server = check("Servidor MCP", "Revisar dirección", "warning", "circle-alert");
  else if (facts.vault === "stopped") server = check("Servidor MCP", "Detenido", "warning", "circle-alert");
  return {tunnel,server};
}
export function needsLocalRepair(s: ConnectionSnapshot, facts: SetupFacts): boolean {
  return s.state === "waiting-for-obsidian" || ((s.state === "stopped" || s.state === "connected") && facts.vault !== "running");
}
export function connectionIndicator(s: ConnectionSnapshot): { icon: string; tone: ConnectionCheck["tone"] } {
  if (s.state === "connected") return {icon:"plug-zap",tone:"ok"};
  if (s.state === "starting" || s.state === "connecting" || s.state === "stopping") return {icon:"loader-circle",tone:"neutral"};
  if (s.state === "error") return {icon:"circle-alert",tone:"error"};
  if (s.state === "waiting-for-obsidian" || s.state === "existing-runtime") return {icon:"circle-alert",tone:"warning"};
  return {icon:"unplug",tone:"neutral"};
}
export function statusCopy(snapshot: ConnectionSnapshot): { title: string; text: string; action: string } {
  switch (snapshot.state) {
    case "connected": return { title: "Disponible", text: "Comprueba el acceso desde ChatGPT.", action: "Abrir ChatGPT" };
    case "starting": case "connecting": return { title: "Conectando…", text: "Puedes cerrar el panel mientras se conecta.", action: "Cancelar" };
    case "stopping": return { title: "Desconectando…", text: "Esperando a que termine la conexión.", action: "Desconectando…" };
    case "waiting-for-obsidian": return { title: "Servidor MCP no disponible", text: "El servidor de esta bóveda necesita atención.", action: "Reparar conexión" };
    case "existing-runtime": return { title: "Cliente en uso", text: "Otro cliente está activo. Consulta el detalle del fallo.", action: "Comprobar" };
    case "error": return { title: "No se pudo conectar", text: snapshot.managed ? "Detén el cliente antes de volver a conectar." : "Consulta el detalle del fallo y vuelve a intentarlo.", action: snapshot.managed ? "Detener" : "Reintentar" };
    case "not-configured": return { title: "Sin configurar", text: "Completa la conexión para usar esta bóveda desde ChatGPT.", action: "Configurar" };
    default: return { title: "Desconectado", text: "Conecta para usar esta bóveda desde ChatGPT.", action: "Conectar" };
  }
}
export interface AnchorRect { left: number; right: number; top: number; bottom: number }
export function popoverPosition(anchor: AnchorRect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const edge = 12, gap = 8;
  const w = Math.max(0, Math.min(width, viewportWidth - edge * 2));
  const h = Math.max(0, Math.min(height, viewportHeight - edge * 2));
  const left = Math.max(edge, Math.min(anchor.right - w, viewportWidth - w - edge));
  const above = anchor.top - gap - h, below = anchor.bottom + gap;
  const preferred = above >= edge || below + h > viewportHeight - edge ? above : below;
  return { left, top: Math.max(edge, Math.min(preferred, viewportHeight - h - edge)), width: w, maxHeight: Math.max(0, viewportHeight - edge * 2) };
}

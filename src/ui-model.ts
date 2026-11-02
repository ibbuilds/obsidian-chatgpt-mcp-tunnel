import type { ConnectionSnapshot } from "./types";
export type Screen = "loading" | "client" | "account" | "chatgpt" | "home" | "settings";
export interface SetupFacts { client: boolean; key: boolean; vault: "running" | "stopped" | "missing" | "authentication" | "missing-tools" | "unexpected-server"; token: boolean; toolCount?: number; writable?: boolean }
export function firstScreen(facts: SetupFacts, validId: boolean, linked: boolean): Screen {
  if (!facts.client || facts.vault !== "running") return "client";
  if (!facts.key || !validId) return "account";
  return linked ? "home" : "chatgpt";
}
export function statusCopy(snapshot: ConnectionSnapshot): { title: string; text: string; action: string } {
  switch (snapshot.state) {
    case "connected": return { title: "Disponible", text: "Comprueba el acceso desde ChatGPT.", action: "Abrir ChatGPT" };
    case "starting": case "connecting": return { title: "Conectando…", text: "Puedes cerrar el panel mientras se conecta.", action: "Cancelar" };
    case "stopping": return { title: "Desconectando…", text: "Esperando a que termine la conexión.", action: "Desconectando…" };
    case "waiting-for-obsidian": return { title: "Esperando a Obsidian", text: "Activa Vault as MCP para continuar.", action: snapshot.managed ? "Desconectar" : "Reintentar" };
    case "existing-runtime": return { title: "Cliente en uso", text: "Otro cliente está activo. Revisa el diagnóstico en Opciones.", action: "Comprobar" };
    case "error": return { title: "No se pudo conectar", text: "Reintenta la conexión o revisa el diagnóstico en Opciones.", action: snapshot.managed ? "Detener" : "Reintentar" };
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

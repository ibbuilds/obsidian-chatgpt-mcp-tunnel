import type { ConnectionSnapshot } from "./types";

export type Screen = "loading" | "client" | "account" | "chatgpt" | "home" | "settings";
export interface SetupFacts {
  client: boolean;
  key: boolean;
  vault: "running" | "stopped" | "missing" | "authentication";
  token: boolean;
}

/** Skip completed steps; never mistake local readiness for a verified ChatGPT connection. */
export function firstScreen(facts: SetupFacts, validId: boolean, linked: boolean): Screen {
  if (!facts.client || facts.vault !== "running") return "client";
  if (!facts.key || !validId) return "account";
  return linked ? "home" : "chatgpt";
}

export function statusCopy(snapshot: ConnectionSnapshot): { title: string; text: string; action: string } {
  switch (snapshot.state) {
    case "connected": return { title: "Tunnel ready", text: "Available to your ChatGPT connection.", action: "Disconnect" };
    case "starting":
    case "connecting": return { title: "Connecting…", text: snapshot.detail, action: "Cancel" };
    case "waiting-for-obsidian": return { title: "Waiting for Vault as MCP", text: "Start its local server, then try again.", action: "Try again" };
    case "existing-runtime": return { title: "Another client is running", text: "Close your manually started tunnel before connecting here. Other processes will not be stopped.", action: "Check again" };
    case "error": return { title: "Connection needs attention", text: snapshot.detail, action: "Retry" };
    case "not-configured": return { title: "Finish setup", text: "Add the missing connection details.", action: "Continue setup" };
    default: return { title: "Tunnel stopped", text: "Connect when you need ChatGPT to reach this vault.", action: "Connect" };
  }
}

export interface AnchorRect { left: number; right: number; top: number; bottom: number }
/** Position beside the status item, not the middle of the window. Clamp to the viewport. */
export function popoverPosition(anchor: AnchorRect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const edge = 12, gap = 8;
  const w = Math.max(0, Math.min(width, viewportWidth - edge * 2));
  const h = Math.max(0, Math.min(height, viewportHeight - edge * 2));
  const left = Math.max(edge, Math.min(anchor.right - w, viewportWidth - w - edge));
  const above = anchor.top - gap - h;
  const below = anchor.bottom + gap;
  const preferred = above >= edge || below + h > viewportHeight - edge ? above : below;
  const top = Math.max(edge, Math.min(preferred, viewportHeight - h - edge));
  return { left, top, width: w, maxHeight: Math.max(0, viewportHeight - edge * 2) };
}

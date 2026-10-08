import { constants } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

async function isWindowsExecutable(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size < 500_000 || metadata.size > 120_000_000) return false;
    const file = await open(path, "r");
    try {
      const header = Buffer.alloc(2);
      await file.read(header, 0, 2, 0);
      return header.toString("ascii") === "MZ";
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

/**
 * Supported official archives include adjacent tunnel-client.exe and
 * cloudflared.exe. The source archive checksum is verified by the installer.
 */
export async function validateClientExecutable(path: string): Promise<void> {
  if (
    basename(path).toLowerCase() !== "tunnel-client.exe" ||
    !(await isWindowsExecutable(path))
  ) {
    throw new Error("Select a valid official tunnel-client.exe.");
  }
  const companionPath = join(dirname(path), "cloudflared.exe");
  if (!(await isWindowsExecutable(companionPath))) {
    throw new Error("cloudflared.exe is missing next to tunnel-client.exe. Reinstall the official client.");
  }
  await access(path, constants.R_OK);
  await access(companionPath, constants.R_OK);
}

export async function isCompleteInstallation(path: string): Promise<boolean> {
  try {
    await validateClientExecutable(path);
    return true;
  } catch {
    return false;
  }
}

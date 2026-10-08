import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { isCompleteInstallation } from "./binaries";
import { localDataDirectory } from "./windows";

const EXECUTABLE = "tunnel-client.exe";
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_CHILDREN = 32;
const MAX_DIRECTORY_CHECKS = 100;

// Only explore likely extraction/install folders, never recursively scan a drive.
const RELEVANT_DIRECTORY = /tunnel|openai|cloudflared|cloudflare|^client$|^v\d+\.\d+\.\d+|^[a-f0-9]{12,64}$/i;

function defaultSearchRoots(): string[] {
  if (process.platform !== "win32") return [];
  const home = process.env.USERPROFILE || homedir();
  const profile = process.env.PATH?.split(delimiter).filter(Boolean) ?? [];
  return [
    join(localDataDirectory(), "client"),
    join(home, "Downloads"),
    join(home, "Desktop"),
    join(home, "Documents"),
    ...profile,
  ];
}

/**
 * Bounded, read-only discovery. Reuses a complete client installation without
 * running anything or changing its files. Explicit paths take precedence.
 *
 * Search scope is deliberately small. A manually installed client outside
 * these locations can always be selected through the UI.
 */
export async function discoverExistingClient(
  configuredPath = "",
  roots: readonly string[] = defaultSearchRoots(),
): Promise<string | null> {
  if (configuredPath && await isCompleteInstallation(configuredPath)) {
    return configuredPath;
  }

  const visited = new Set<string>();
  let directories = 0;

  async function scan(directory: string, depth: number): Promise<string | null> {
    const normalized = directory.toLowerCase();
    if (visited.has(normalized) || directories++ >= MAX_DIRECTORY_CHECKS) return null;
    visited.add(normalized);

    const candidate = join(directory, EXECUTABLE);
    if (await isCompleteInstallation(candidate)) return candidate;
    if (depth === 0) return null;

    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }

    if (entries.length > MAX_DIRECTORY_ENTRIES) return null;
    const dirs = entries
      .filter((entry) => entry.isDirectory() && RELEVANT_DIRECTORY.test(entry.name))
      .slice(0, MAX_CHILDREN);
    for (const entry of dirs) {
      const found = await scan(join(directory, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  }

  for (const root of roots) {
    // Depth 3 handles the version/digest hierarchy of our own installer,
    // as well as typical extracted OpenAI client ZIPs in Downloads.
    const found = await scan(root, 3);
    if (found) return found;
  }
  return null;
}

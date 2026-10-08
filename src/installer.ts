import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { downloadVerifiedZip, readGithubJson } from "./network";
import { RELEASES_API, selectWindowsRelease, type GithubRelease } from "./release";
import { localDataDirectory, runPowerShell } from "./windows";

const EXTRACT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Expand-Archive -LiteralPath $env:OBSIDIAN_TUNNEL_ARCHIVE -DestinationPath $env:OBSIDIAN_TUNNEL_DEST -Force",
].join("\n");

export type InstallProgress = "metadata" | "downloading" | "verifying" | "installing";

async function findExecutable(directory: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 100) throw new Error("Unexpected archive structure.");
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === "tunnel-client.exe") {
      return join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findExecutable(join(directory, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

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

export async function validateClientExecutable(path: string): Promise<void> {
  if (!path.toLowerCase().endsWith(".exe") || !(await isWindowsExecutable(path))) {
    throw new Error("Select a valid Windows tunnel-client.exe.");
  }
  await access(path, constants.R_OK);
}

/** Explicit download from OpenAI releases; archive size and SHA-256 must match GitHub metadata. */
export async function installOfficialClient(
  onProgress: (state: InstallProgress) => void = () => undefined,
): Promise<string> {
  if (process.platform !== "win32") throw new Error("Windows is required.");
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) throw new Error("Unsupported Windows processor.");

  onProgress("metadata");
  const release = selectWindowsRelease((await readGithubJson(RELEASES_API)) as GithubRelease, arch);
  const finalDir = join(localDataDirectory(), "client", release.version);
  const destination = join(finalDir, "tunnel-client.exe");
  if (await isWindowsExecutable(destination)) return destination;

  const temporaryDir = await mkdtemp(join(tmpdir(), "obsidian-mcp-tunnel-"));
  try {
    const archive = join(temporaryDir, basename(release.name));
    const extraction = join(temporaryDir, "extracted");
    onProgress("downloading");
    await downloadVerifiedZip(release.url, archive, release.sha256, release.size);
    onProgress("verifying");
    await mkdir(extraction);
    await runPowerShell(EXTRACT_SCRIPT, "", {
      OBSIDIAN_TUNNEL_ARCHIVE: archive,
      OBSIDIAN_TUNNEL_DEST: extraction,
    }, 90_000);
    const executable = await findExecutable(extraction);
    if (!executable || !(await isWindowsExecutable(executable))) {
      throw new Error("Verified archive does not contain a valid tunnel-client.exe.");
    }

    onProgress("installing");
    await mkdir(finalDir, { recursive: true });
    const staging = join(finalDir, "client-" + randomUUID() + ".tmp");
    try {
      await copyFile(executable, staging);
      await rename(staging, destination);
    } finally {
      await rm(staging, { force: true });
    }
    await validateClientExecutable(destination);
    return destination;
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

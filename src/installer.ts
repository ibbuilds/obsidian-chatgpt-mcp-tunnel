import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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

/**
 * Official OpenAI distributions contain *two* adjacent executables:
 * tunnel-client.exe and cloudflared.exe. Both must be kept together.
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

async function isCompleteInstallation(path: string): Promise<boolean> {
  try {
    await validateClientExecutable(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit, verified installation. The complete release payload is kept
 * together and installed atomically within the user-local app directory.
 */
export async function installOfficialClient(
  onProgress: (state: InstallProgress) => void = () => undefined,
): Promise<string> {
  if (process.platform !== "win32") throw new Error("Windows is required.");
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) throw new Error("Unsupported Windows processor.");

  onProgress("metadata");
  const release = selectWindowsRelease((await readGithubJson(RELEASES_API)) as GithubRelease, arch);
  // Digest-scoped directories don't overwrite an already running client or old incomplete installs.
  const destinationDir = join(
    localDataDirectory(), "client", release.version, release.sha256.slice(0, 12),
  );
  const destination = join(destinationDir, "tunnel-client.exe");
  if (await isCompleteInstallation(destination)) return destination;

  const temp = await mkdtemp(join(tmpdir(), "obsidian-mcp-tunnel-"));
  const installRoot = join(localDataDirectory(), "client");
  const staging = join(installRoot, ".install-" + randomUUID());

  try {
    const archive = join(temp, basename(release.name));
    const extraction = join(temp, "extracted");
    onProgress("downloading");
    await downloadVerifiedZip(release.url, archive, release.sha256, release.size);

    onProgress("verifying");
    await mkdir(extraction);
    await runPowerShell(EXTRACT_SCRIPT, "", {
      OBSIDIAN_TUNNEL_ARCHIVE: archive,
      OBSIDIAN_TUNNEL_DEST: extraction,
    }, 90_000);

    const executable = await findExecutable(extraction);
    if (!executable) throw new Error("The verified archive is missing tunnel-client.exe.");
    await validateClientExecutable(executable);

    onProgress("installing");
    await mkdir(installRoot, { recursive: true });
    await cp(dirname(executable), staging, { recursive: true, force: false, errorOnExist: true });
    await validateClientExecutable(join(staging, "tunnel-client.exe"));
    await mkdir(dirname(destinationDir), { recursive: true });

    try {
      await rename(staging, destinationDir);
    } catch (error) {
      // A concurrent installer may already have completed the exact same release.
      if (!(await isCompleteInstallation(destination))) throw error;
    }

    await validateClientExecutable(destination);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
}

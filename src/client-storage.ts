import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isCompleteInstallation, validateClientExecutable } from "./binaries";

export function managedClientRoot(pluginDirectory: string): string {
  if (!isAbsolute(pluginDirectory)) throw new Error("The plugin needs a local filesystem vault to install the client.");
  return join(pluginDirectory, "client");
}

export function isManagedClient(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return !!rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

async function bundleDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  for (const name of ["tunnel-client.exe", "cloudflared.exe"]) {
    hash.update(name);
    for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  }
  return hash.digest("hex");
}

/** Copy only the two selected binaries, never an entire Downloads directory. */
export async function keepClientNearPlugin(source: string, root: string): Promise<string> {
  await validateClientExecutable(source);
  if (isManagedClient(source, root)) return source;
  const digest = await bundleDigest(dirname(source));
  const destinationDir = join(root, "imported", digest);
  const destination = join(destinationDir, "tunnel-client.exe");
  if (await isCompleteInstallation(destination) && await bundleDigest(destinationDir) === digest) return destination;
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, ".import-" + randomUUID() + "-"));
  try {
    for (const name of ["tunnel-client.exe", "cloudflared.exe"]) {
      await copyFile(join(dirname(source), name), join(staging, name));
    }
    await validateClientExecutable(join(staging, "tunnel-client.exe"));
    if (await bundleDigest(staging) !== digest) throw new Error("The selected client changed while being copied. Try again.");
    await mkdir(dirname(destinationDir), { recursive: true });
    try { await rename(staging, destinationDir); }
    catch {
      if (!(await isCompleteInstallation(destination)) || await bundleDigest(destinationDir) !== digest) {
        throw new Error("The saved client bundle is damaged. Install the official client again.");
      }
    }
    return destination;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

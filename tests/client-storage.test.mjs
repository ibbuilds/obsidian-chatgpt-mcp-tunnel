import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "cmt-storage-module-"));
let keepClientNearPlugin, managedClientRoot, isManagedClient;
try {
  const bundle = join(temporary, "storage.cjs");
  await esbuild.build({ entryPoints: ["src/client-storage.ts"], bundle: true, platform: "node", format: "cjs", outfile: bundle });
  ({ keepClientNearPlugin, managedClientRoot, isManagedClient } = createRequire(import.meta.url)(bundle));
} finally { await rm(temporary, { recursive: true, force: true }); }

test("moves no original files and keeps only the selected binaries beside the plugin", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cmt-storage-test-"));
  try {
    const downloads = join(temporary, "Downloads"), root = managedClientRoot(join(temporary, "plugin"));
    await mkdir(downloads);
    const exe = Buffer.alloc(600000); exe.write("MZ");
    for (const name of ["tunnel-client.exe", "cloudflared.exe"]) await writeFile(join(downloads, name), exe);
    await writeFile(join(downloads, "private-document.txt"), "Must not be copied");
    const source = join(downloads, "tunnel-client.exe");
    const saved = await keepClientNearPlugin(source, root);
    assert.equal(isManagedClient(saved, root), true);
    assert.deepEqual((await readdir(dirname(saved))).sort(), ["cloudflared.exe", "tunnel-client.exe"]);
    assert.deepEqual(await readFile(saved), await readFile(source));
    assert.equal(await keepClientNearPlugin(source, root), saved);
    assert.equal(await keepClientNearPlugin(saved, root), saved);
    assert.equal(isManagedClient(join(temporary, "client-other", "tunnel-client.exe"), root), false);
    assert.throws(() => managedClientRoot("relative-path"), /local filesystem/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("concurrent imports resolve to one complete bundle", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cmt-storage-concurrent-"));
  try {
    const exe = Buffer.alloc(600000); exe.write("MZ");
    for (const name of ["tunnel-client.exe", "cloudflared.exe"]) await writeFile(join(temporary, name), exe);
    const root = managedClientRoot(join(temporary, "plugin")), source = join(temporary, "tunnel-client.exe");
    const results = await Promise.all([keepClientNearPlugin(source, root), keepClientNearPlugin(source, root)]);
    assert.equal(results[0], results[1]);
    assert.equal((await readdir(root)).some(name => name.startsWith(".import-")), false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

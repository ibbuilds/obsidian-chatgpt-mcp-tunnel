import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const bundleDir = await mkdtemp(join(tmpdir(), "chatgpt-discovery-bundle-"));
let discoverExistingClient;
try {
  const bundle = join(bundleDir, "discovery.cjs");
  await esbuild.build({
    entryPoints: ["src/discovery.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundle,
  });
  discoverExistingClient = createRequire(import.meta.url)(bundle).discoverExistingClient;
} finally {
  await rm(bundleDir, { recursive: true, force: true });
}

const fakeExe = Buffer.alloc(600_000);
fakeExe.write("MZ", 0, "ascii");

test("discovers a complete extracted official client in a typical download folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-client-discovery-"));
  try {
    const extracted = join(root, "tunnel-client-v0.0.16-windows-amd64", "client");
    await mkdir(extracted, { recursive: true });
    const expected = join(extracted, "tunnel-client.exe");
    await writeFile(expected, fakeExe);
    await writeFile(join(extracted, "cloudflared.exe"), fakeExe);
    assert.equal(await discoverExistingClient("", [root]), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not report a partial or unrelated executable as installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-client-discovery-"));
  try {
    const unpacked = join(root, "openai-tools");
    await mkdir(unpacked, { recursive: true });
    await writeFile(join(unpacked, "tunnel-client.exe"), fakeExe);
    assert.equal(await discoverExistingClient("", [root]), null);
    await writeFile(join(unpacked, "cloudflared.exe"), fakeExe);
    assert.equal(await discoverExistingClient("", [root]), join(unpacked, "tunnel-client.exe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a valid configured executable takes priority over auto-discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-client-discovery-"));
  try {
    const selected = join(root, "tunnel-client.exe");
    await writeFile(selected, fakeExe);
    await writeFile(join(root, "cloudflared.exe"), fakeExe);
    assert.equal(await discoverExistingClient(selected, []), selected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Real Windows integration smoke test. Runs only in CI on Windows.
 *
 * Downloads the latest official OpenAI release, verifies SHA-256, extracts both
 * binaries, checks the executable and tests idempotent installation.
 * No API key, active tunnel or ChatGPT account is required.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

if (process.platform !== "win32") {
  throw new Error("The official Windows client smoke test requires Windows.");
}

const workspace = await mkdtemp(join(tmpdir(), "chatgpt-mcp-smoke-"));
const original = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = workspace;

try {
  const bundle = join(workspace, "installer.cjs");
  await esbuild.build({
    entryPoints: ["src/installer.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundle,
  });

  const require = createRequire(import.meta.url);
  const { installOfficialClient } = require(bundle);

  const executable = await installOfficialClient((progress) => {
    console.log("Official client:", progress);
  });
  const sibling = join(dirname(executable), "cloudflared.exe");
  assert.equal((await stat(executable)).isFile(), true);
  assert.equal((await stat(sibling)).isFile(), true);

  // The program itself must run successfully; an "MZ" header is not enough.
  const version = await new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && output.trim()) resolve(output.trim().slice(0, 200));
      else reject(new Error("Official client --version failed: exit " + code + " " + output.slice(0, 1000)));
    });
    setTimeout(() => child.kill(), 15_000).unref();
  });
  console.log("Official executable:", version);

  const reused = await installOfficialClient();
  assert.equal(reused, executable, "Repeat installation should reuse the verified local bundle");
  console.log("Official Windows client smoke test passed.");
} finally {
  if (original === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = original;
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

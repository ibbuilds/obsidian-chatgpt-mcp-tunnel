/**
 * Real Windows integration smoke test. Requires Windows.
 *
 * Downloads the latest official OpenAI release, verifies SHA-256, extracts both
 * binaries, validates the actual production launch options and tests reuse.
 * Set TUNNEL_CLIENT_SMOKE_PATH to check an already-installed official client.
 * No API key, active tunnel or ChatGPT account is required.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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

  const executable = process.env.TUNNEL_CLIENT_SMOKE_PATH || await installOfficialClient((progress) => {
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

  const runtimeBundle = join(workspace, "runtime.cjs");
  await esbuild.build({ entryPoints: ["src/runtime-services.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: runtimeBundle });
  const { clientLaunchArguments } = require(runtimeBundle);
  const environmentBundle = join(workspace, "environment.cjs");
  await esbuild.build({ entryPoints: ["src/runtime-environment.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: environmentBundle });
  const { clientEnvironment } = require(environmentBundle);

  // Doctor validates the real CLI contract without polling OpenAI or using real credentials.
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const config = { tunnelId: "tunnel_" + "a".repeat(32), mcpUrl: "http://127.0.0.1:" + server.address().port + "/mcp" };
    const args = clientLaunchArguments().slice(1).map(arg => arg.startsWith("--health.listen-addr=") ? "--health.listen-addr=127.0.0.1:0" : arg);
    const report = await new Promise((resolve, reject) => {
      const child = spawn(executable, ["doctor", "--json", ...args], {
        windowsHide: true, cwd: dirname(executable), stdio: ["ignore", "pipe", "pipe"],
        env: clientEnvironment(process.env, config, "sk-offline-installation-smoke-test"),
      });
      let output = "";
      const timeout = setTimeout(() => child.kill(), 15_000);
      child.stdout.on("data", chunk => { output = (output + chunk).slice(-32768); });
      child.stderr.on("data", () => {});
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("close", code => {
        clearTimeout(timeout);
        try {
          const report = JSON.parse(output);
          if (code !== 0 || report.result !== "ok") {
            const failures = report.checks.filter(check => check.status === "FAIL").map(check => check.summary);
            reject(new Error("Official client launch configuration failed: " + failures.join("; ")));
          } else resolve(report);
        } catch (error) { reject(error); }
      });
    });
    assert.equal(report.result, "ok");
    console.log("Official client accepted the production launch options.");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  if (!process.env.TUNNEL_CLIENT_SMOKE_PATH) {
    const reused = await installOfficialClient();
    assert.equal(reused, executable, "Repeat installation should reuse the verified local bundle");
  }
  console.log("Official Windows client smoke test passed.");
} finally {
  if (original === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = original;
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

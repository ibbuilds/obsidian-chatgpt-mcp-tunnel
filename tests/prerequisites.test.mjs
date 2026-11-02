import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
const temporary = await mkdtemp(join(tmpdir(), "cmt-prerequisite-tests-"));
let startVaultServer, vaultConnectionDetails;
try {
  const bundle = join(temporary, "prerequisites.cjs");
  await esbuild.build({ entryPoints: ["src/prerequisites.ts"], bundle: true, platform: "node", format: "cjs", outfile: bundle });
  ({ startVaultServer, vaultConnectionDetails } = createRequire(import.meta.url)(bundle));
} finally { await rm(temporary, { recursive: true, force: true }); }

test("local preparation can enable an installed dependency and await its startup", async () => {
  let enabled = false, running = false, starts = 0;
  const server = { getServerStatus: () => running ? "running" : "stopped", startServer: async () => { running = true; starts++; }, serverPort: () => 9876, bearerToken: () => "local-test-token" };
  const app = { vault: { configDir: ".obsidian", adapter: { exists: async () => true } }, plugins: {
    getPlugin: () => enabled ? server : null, enablePluginAndSave: async () => { enabled = true; },
  } };
  await startVaultServer(app);
  assert.equal(enabled, false, "Background checks respect a deliberately disabled dependency");
  await startVaultServer(app, true); await startVaultServer(app, true);
  assert.equal(starts, 1); assert.deepEqual(vaultConnectionDetails(app), { endpoint: "http://127.0.0.1:9876/mcp", token: "local-test-token" });
});

test("missing dependencies and unsupported TLS get actionable errors without exposing tokens", async () => {
  const app = { vault: { configDir: ".obsidian", adapter: { exists: async () => false } }, plugins: { getPlugin: () => null } };
  await assert.rejects(startVaultServer(app, true), /Install Vault as MCP/);
  app.plugins.getPlugin = () => ({ serverPort: () => 8765, tlsEnabled: () => true, bearerToken: () => "DO_NOT_DISPLAY" });
  assert.throws(() => vaultConnectionDetails(app), error => /HTTPS/.test(error.message) && !error.message.includes("DO_NOT_DISPLAY"));
});

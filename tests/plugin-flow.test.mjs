import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "cmt-plugin-tests-"));
let Plugin;
try {
  const bundle = join(temporary, "plugin.cjs");
  await esbuild.build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "cjs", outfile: bundle,
    plugins: [{ name: "obsidian-lifecycle-double", setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "double" }));
      build.onLoad({ filter: /.*/, namespace: "double" }, () => ({ contents: 'export class Plugin {} export class PluginSettingTab {} export class Setting {} export class ButtonComponent {} export class TextComponent {} export class ToggleComponent {} export class Notice {} export function setIcon() {}' }));
    } }],
  });
  Plugin = createRequire(import.meta.url)(bundle).default;
} finally { await rm(temporary, { recursive: true, force: true }); }

function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const plugin = new Plugin(); let connections = 0, disconnects = 0;
  plugin.settings = { clientPath: "test-client", tunnelId: "tunnel_" + "a".repeat(32), mcpUrl: "http://127.0.0.1:8765/mcp", autoConnect: true, autoDetectLocal: true };
  plugin.app = { plugins: { getPlugin: () => null } };
  plugin.manager = { activeSession: true, snapshot: { state: "connected" },
    disconnect: async () => { plugin.manager.activeSession = false; disconnects++; },
    connectNow: async () => { plugin.manager.activeSession = true; connections++; },
  };
  plugin.saveData = async () => {};
  plugin.secrets = { hasKey: async () => true, saveKeyAndCommit: async (_value, commit) => commit(), saveMcpTokenAndCommit: async (_value, commit) => commit() };
  return { plugin, connections: () => connections, disconnects: () => disconnects };
}

test("a failed account save preserves the old settings and resumes the previous connection", async () => {
  const f = fixture(), original = { ...f.plugin.settings };
  f.plugin.saveData = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(f.plugin.saveAccount("tunnel_" + "b".repeat(32), "sk-replacement-test-key"), /Could not save plugin settings/);
  assert.deepEqual(f.plugin.settings, original);
  assert.equal(f.connections(), 1);
});

test("switching unchanged local settings to manual does not restart a healthy tunnel", async () => {
  const f = fixture();
  await f.plugin.saveLocal(f.plugin.settings.mcpUrl, "");
  assert.equal(f.plugin.settings.autoDetectLocal, false);
  assert.equal(f.disconnects(), 0); assert.equal(f.connections(), 0);
});

test("disconnect during a pending settings save cannot reconnect afterward", async () => {
  const f = fixture(), pending = deferred();
  f.plugin.saveData = () => pending.promise;
  const save = f.plugin.saveLocal("http://127.0.0.1:9876/mcp", "");
  await settle(); f.plugin.disconnect(); pending.resolve(); await save;
  assert.equal(f.connections(), 0);
});

test("disconnect during automatic server preparation cancels the late connection", async () => {
  const f = fixture(), pending = deferred();
  f.plugin.app.plugins.getPlugin = () => ({ getServerStatus: () => "stopped", startServer: () => pending.promise });
  const connect = f.plugin.connect();
  await settle(); f.plugin.disconnect(); pending.resolve(); await connect;
  assert.equal(f.connections(), 0);
});

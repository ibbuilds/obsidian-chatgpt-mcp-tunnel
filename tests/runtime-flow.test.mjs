import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
const dir = await mkdtemp(join(tmpdir(), "cmt-flow-tests-"));
const require = createRequire(import.meta.url);
let TunnelManager, clientEnvironment, stopOwnedProcess;
try {
  for (const name of ["manager", "runtime-environment", "runtime-services"]) {
    const output = join(dir, name + ".cjs");
    await esbuild.build({ entryPoints: ["src/" + name + ".ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: output });
    const module = require(output);
    if (name === "manager") TunnelManager = module.TunnelManager;
    if (name === "runtime-environment") clientEnvironment = module.clientEnvironment;
    if (name === "runtime-services") stopOwnedProcess = module.stopOwnedProcess;
  }
} finally { await rm(dir, { recursive: true, force: true }); }
const config = { clientPath: "C:\\OpenAI\\tunnel-client.exe", tunnelId: "tunnel_" + "a".repeat(32), mcpUrl: "http://127.0.0.1:8765/mcp", autoConnect: true };
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}, preferences = {}) {
  let now = 1000, health = 200;
  const children = [], states = [], stopped = [];
  const secrets = { hasKey: async () => true, readKey: async () => "sk-fake-key-for-test-only", hasMcpToken: async () => false, readMcpToken: async () => "local-test-token" };
  const services = {
    validate: async () => {}, probe: async () => "ready", portOpen: async () => false,
    http: async url => url.port === "8080" ? null : health,
    launch: () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null; child.signalCode = null;
      children.push(child); return child;
    },
    stop: async child => { stopped.push(child); child.exitCode = 0; child.emit("close", 0); },
    now: () => now, ...overrides,
  };
  let manager;
  manager = new TunnelManager(() => ({ ...config, ...preferences }), secrets, () => states.push(manager.snapshot), services);
  return { manager, children, states, stopped, secrets, clock: n => now += n, health: n => health = n };
}

test("cancel during preflight prevents any subsequent launch", async () => {
  const gate = deferred(); const f = fixture({ validate: () => gate.promise });
  const start = f.manager.connectNow(); await settle();
  assert.equal(f.manager.snapshot.state, "starting");
  await f.manager.disconnect(); gate.resolve(); await start;
  assert.equal(f.children.length, 0); assert.equal(f.manager.snapshot.state, "stopped"); f.manager.dispose();
});

test("cancel followed immediately by reconnect starts exactly one current session", async () => {
  const gate = deferred(); const f = fixture({ validate: () => gate.promise });
  const first = f.manager.connectNow(); await settle(); await f.manager.disconnect();
  const second = f.manager.connectNow(); gate.resolve(); await Promise.all([first, second]);
  assert.equal(f.children.length, 1); assert.equal(f.manager.snapshot.managed, true); await f.manager.disconnect();
});

test("replacement waits for the owned process to stop", async () => {
  const gate = deferred(); const f = fixture({ stop: async child => { await gate.promise; child.emit("close", 0); } });
  await f.manager.connectNow(); const stop = f.manager.disconnect(); const restart = f.manager.connectNow();
  await settle(); assert.equal(f.children.length, 1); assert.equal(f.manager.snapshot.state, "stopping");
  gate.resolve(); await Promise.all([stop, restart]); assert.equal(f.children.length, 2); await f.manager.disconnect();
});

test("late health responses cannot overwrite a newer connection", async () => {
  const gate = deferred(); const f = fixture({ http: url => url.port === "8080" ? Promise.resolve(null) : gate.promise });
  await f.manager.connectNow(); const check = f.manager.tick();
  await f.manager.disconnect(); await f.manager.connectNow(); gate.resolve(200); await check;
  assert.equal(f.manager.snapshot.state, "connecting"); await f.manager.disconnect();
});

test("bad credentials stop automatic retry instead of hammering the service", async () => {
  const f = fixture(); await f.manager.connectNow();
  f.children[0].stderr.emit("data", Buffer.from("HTTP 403 Forbidden sk-DO_NOT_DISPLAY")); f.children[0].emit("close", 1);
  assert.equal(f.manager.snapshot.state, "error"); assert.equal(f.manager.snapshot.retryAt, undefined);
  assert.doesNotMatch(f.manager.snapshot.detail, /DO_NOT_DISPLAY/);
  f.clock(120_000); await f.manager.tick(); assert.equal(f.children.length, 1); f.manager.dispose();
});

test("transient failures back off and manual disconnect cancels the retry", async () => {
  const f = fixture(); await f.manager.connectNow(); f.children[0].stderr.emit("data", Buffer.from("i/o timeout")); f.children[0].emit("close", 1);
  assert.equal(f.manager.snapshot.retryAt, 5000);
  await f.manager.tick(); assert.equal(f.children.length, 1);
  await f.manager.disconnect(); f.clock(10_000); await f.manager.tick(); assert.equal(f.children.length, 1); f.manager.dispose();
});

test("readiness timeout stops the failed client and schedules a bounded retry", async () => {
  const f = fixture(); f.health(503); await f.manager.connectNow(); f.clock(60_001); await f.manager.tick();
  assert.equal(f.stopped.length, 1); assert.equal(f.manager.snapshot.state, "error");
  assert.match(f.manager.snapshot.detail, /60 seconds/); assert.ok(f.manager.snapshot.retryAt); f.manager.dispose();
});

test("loss of a previously healthy connection is detected", async () => {
  const f = fixture(); await f.manager.connectNow(); await f.manager.tick(); assert.equal(f.manager.snapshot.state, "connected");
  f.health(null); f.clock(15_001); await f.manager.tick(); assert.equal(f.stopped.length, 1);
  assert.equal(f.manager.snapshot.state, "error"); f.manager.dispose();
});

test("a failed stop never starts an overlapping replacement", async () => {
  const f = fixture({ stop: async () => { throw new Error("blocked"); } });
  await f.manager.connectNow(); await assert.rejects(f.manager.disconnect(), /stopped safely/); await f.manager.connectNow();
  assert.equal(f.children.length, 1); assert.equal(f.manager.snapshot.managed, true); f.manager.dispose();
});

test("an external listener is not terminated or replaced", async () => {
  const f = fixture({ portOpen: async () => true }); await f.manager.connectNow();
  assert.equal(f.manager.snapshot.state, "existing-runtime"); assert.equal(f.children.length, 0); assert.equal(f.stopped.length, 0); f.manager.dispose();
});

test("plugin unload cancels a pending credential lookup", async () => {
  const gate = deferred(); const f = fixture(); f.secrets.readKey = () => gate.promise;
  const pending = f.manager.connectNow(); await settle(); f.manager.dispose(); gate.resolve("fake-runtime-key"); await pending;
  assert.equal(f.children.length, 0);
});

test("direct polling is retained and unsafe inherited configuration is stripped case-insensitively", () => {
  const env = clientEnvironment({ Path: "system", SystemRoot: "C:\\Windows", HTTP_PROXY: "http://local-proxy", control_plane_base_url: "https://untrusted.invalid", OPENAI_API_KEY: "unrelated", MCP_EXTRA_HEADERS: "bad", LOG_HTTP_RAW_UNSAFE: "true", LOG_FILE: "vault.log", CLOUDFLARED_MANAGED: "true", TUNNEL_CLIENT_CONFIG: "other.yaml" }, config, "runtime-test", "local-test");
  assert.equal(env.CONTROL_PLANE_BASE_URL, "https://api.openai.com"); assert.equal(env.CONTROL_PLANE_API_KEY, "runtime-test");
  assert.equal(env.CLOUDFLARED_MANAGED, "false"); assert.equal(env.LOG_HTTP_RAW_UNSAFE, "false");
  assert.equal(env.control_plane_base_url, undefined); assert.equal(env.LOG_FILE, undefined); assert.equal(env.TUNNEL_CLIENT_CONFIG, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.MCP_EXTRA_HEADERS, "Authorization: Bearer local-test"); assert.equal(env.Path, "system"); assert.equal(env.HTTP_PROXY, "http://local-proxy");
});

test("owned child shutdown waits for actual process exit", { timeout: 15_000 }, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  try { await stopOwnedProcess(child); assert.ok(child.exitCode !== null || child.signalCode !== null); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
});


test("disabled automatic start remains idle until user explicitly connects", async () => {
  const f = fixture({}, { autoConnect: false });
  f.manager.begin();
  await settle();
  assert.equal(f.children.length, 0);
  assert.equal(f.manager.snapshot.state, "stopped");
  await f.manager.connectNow();
  assert.equal(f.children.length, 1);
  await f.manager.disconnect(); f.manager.dispose();
});

test("local Vault as MCP starting late is handled without a second process", async () => {
  let available = false;
  const f = fixture({ probe: async () => available ? "ready" : "unavailable" });
  f.manager.begin();
  await settle();
  assert.equal(f.manager.snapshot.state, "waiting-for-obsidian");
  assert.equal(f.children.length, 0);
  available = true;
  await f.manager.tick();
  assert.equal(f.children.length, 1);
  await f.manager.connectNow();
  assert.equal(f.children.length, 1, "An already-running client must not be duplicated");
  await f.manager.disconnect(); f.manager.dispose();
});

test("an invalid local bearer token blocks startup without automatic hammering", async () => {
  const f = fixture({ probe: async () => "authentication-required" });
  f.secrets.hasMcpToken = async () => true;
  await f.manager.connectNow();
  assert.equal(f.manager.snapshot.state, "error");
  assert.match(f.manager.snapshot.detail, /local MCP token.*rejected/i);
  assert.equal(f.manager.snapshot.retryAt, undefined);
  assert.equal(f.children.length, 0);
  f.clock(60_000);
  await f.manager.tick();
  assert.equal(f.children.length, 0);
  f.manager.dispose();
});

test("simultaneous Connect actions never create overlapping tunnel processes", async () => {
  const f = fixture();
  await Promise.all([
    f.manager.connectNow(),
    f.manager.connectNow(),
    f.manager.connectNow(),
  ]);
  assert.equal(f.children.length, 1);
  await f.manager.disconnect(); f.manager.dispose();
});

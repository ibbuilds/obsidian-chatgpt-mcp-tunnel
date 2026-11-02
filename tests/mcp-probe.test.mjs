import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "chatgpt-mcp-probe-tests-"));
let probeVaultMcp, inspectVaultMcp;
try {
  const output = join(dir, "mcp-probe.cjs");
  await esbuild.build({
    entryPoints: ["src/mcp-probe.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: output,
  });
  ({ probeVaultMcp, inspectVaultMcp } = createRequire(import.meta.url)(output));
} finally {
  // Module is already loaded into Node memory at this point.
  await rm(dir, { recursive: true, force: true });
}

async function localServer(handler, action) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await action("http://127.0.0.1:" + port + "/mcp");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("verifies Vault as MCP's actual JSON-RPC identity without reading notes", async () => {
  let observedMethod = null;
  await localServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body);
    observedMethod = payload.method;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "obsidian-vault-mcp", version: "1.2.0" },
        capabilities: { tools: {} },
      },
    }));
  }, async (url) => {
    assert.equal(await probeVaultMcp(url), "ready");
    assert.equal(observedMethod, "initialize");
  });
});

test("discovers real note tools with a stateful SSE transport and closes its session", async () => {
  const methods = [], session = "test-session-123";
  await localServer(async (request, response) => {
    if (request.method === "DELETE") {
      methods.push("DELETE"); assert.equal(request.headers["mcp-session-id"], session);
      response.writeHead(204); response.end(); return;
    }
    let text = ""; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text); methods.push(body.method);
    if (body.method === "initialize") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Mcp-Session-Id": session });
      response.write('event: message\r\ndata: ' + JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {
        protocolVersion: "2025-06-18", serverInfo: { name: "obsidian-vault-mcp" }, capabilities: { tools: {} },
      } }) + '\r\n\r\n');
      return; // Stream intentionally stays open.
    }
    assert.equal(request.headers["mcp-session-id"], session);
    assert.equal(request.headers["mcp-protocol-version"], "2025-06-18");
    if (body.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
    assert.equal(body.method, "tools/list");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(': heartbeat\n\ndata: ' + JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {
      tools: ["list_notes", "read_note", "search_notes", "create_note", "patch_note"].map(name => ({ name })),
    } }) + '\n\n');
  }, async (url) => {
    assert.deepEqual(await inspectVaultMcp(url), { state: "ready", toolCount: 5, writable: true });
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "DELETE"]);
    assert.ok(!methods.includes("tools/call"), "Discovery never reads or writes notes");
  });
});

test("a correctly named server without note tools does not pass discovery", async () => {
  await localServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    if (!body.id) { response.writeHead(202); response.end(); return; }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize"
      ? { serverInfo: { name: "obsidian-vault-mcp" } } : { tools: [{ name: "unrelated_tool" }] } }));
  }, async url => {
    assert.equal((await inspectVaultMcp(url)).state, "missing-tools");
  });
});

test("a truncated response cannot leave an MCP check pending", async () => {
  await localServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "5000" });
    response.write('{"jsonrpc":"2.0"'); setImmediate(() => response.destroy());
  }, async url => {
    assert.equal(await probeVaultMcp(url), "unavailable");
  });
});

test("detects the optional Vault as MCP bearer authorization", async () => {
  await localServer((request, response) => {
    if (request.headers.authorization !== "Bearer test-token-123456") {
      response.writeHead(401);
      response.end("Unauthorized");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: "chatgpt-mcp-tunnel-identity-check",
      result: { serverInfo: { name: "obsidian-vault-mcp" } },
    }));
  }, async (url) => {
    assert.equal(await probeVaultMcp(url), "authentication-required");
    assert.equal(await probeVaultMcp(url, "wrong-token"), "authentication-required");
    assert.equal(await probeVaultMcp(url, "test-token-123456"), "ready");
  });
});

test("rejects unrelated listeners and non-loopback addresses", async () => {
  await localServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      result: { serverInfo: { name: "some-other-server" } },
    }));
  }, async (url) => {
    assert.equal(await probeVaultMcp(url), "unexpected-server");
  });
  assert.equal(await probeVaultMcp("http://example.com:8765/mcp"), "unexpected-server");
  assert.equal(await probeVaultMcp("http://127.0.0.1:0/mcp"), "unexpected-server");
});

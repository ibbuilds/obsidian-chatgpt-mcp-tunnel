import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "chatgpt-mcp-probe-tests-"));
let probeVaultMcp;
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
  probeVaultMcp = createRequire(import.meta.url)(output).probeVaultMcp;
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

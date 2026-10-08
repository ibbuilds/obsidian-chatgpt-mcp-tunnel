import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidTunnelId,
  hasValidConfiguration,
  parseLocalMcpEndpoint,
  parseHealthBaseUrl,
} from "../src/validation.ts";

const id = "tunnel_" + "a".repeat(32);

test("accepts lowercase alphanumeric and namespaced OpenAI tunnel IDs", () => {
  assert.equal(isValidTunnelId(id), true);
  assert.equal(isValidTunnelId(" " + id + " "), true);
  assert.equal(isValidTunnelId("tunnel_a1b2_" + "z".repeat(32)), true);
  assert.equal(isValidTunnelId("tunnel_" + "z".repeat(32)), true);
  for (const value of ["tunnel_123", "TUNNEL_" + "a".repeat(32), "tunnel_" + "#".repeat(32), "tunnel_abc_" + "a".repeat(32), "tunnel_ABCDE_" + "a".repeat(32)]) {
    assert.equal(isValidTunnelId(value), false);
  }
});

test("MCP URL stays on a literal loopback host", () => {
  const valid = ["http://127.0.0.1:8765/mcp", "http://[::1]:8765/mcp"];
  for (const value of valid) assert.ok(parseLocalMcpEndpoint(value));
  const invalid = [
    "http://192.168.1.5:8765/mcp",
    "http://localhost:8765/mcp",
    "https://127.0.0.1:8765/mcp",
    "http://127.0.0.1/mcp",
    "http://127.0.0.1:8765/admin",
    "http://127.0.0.1:8765/mcp?x=y",
    "http://admin:password@127.0.0.1:8765/mcp",
    "file:///etc/passwd",
  ];
  for (const value of invalid) assert.equal(parseLocalMcpEndpoint(value), null, value);
});

test("health URLs only resolve to a local listener", () => {
  assert.equal(parseHealthBaseUrl("http://127.0.0.1:50213/healthz")?.href, "http://127.0.0.1:50213/");
  assert.equal(parseHealthBaseUrl("http://127.0.0.1:50213/")?.href, "http://127.0.0.1:50213/");
  assert.equal(parseHealthBaseUrl("http://example.com:8080/"), null);
  assert.equal(parseHealthBaseUrl("http://127.0.0.1:8080/ui"), null);
});

test("validates all required connection fields", () => {
  assert.equal(hasValidConfiguration("C:\\tunnel-client.exe", id, "http://127.0.0.1:8765/mcp"), true);
  assert.equal(hasValidConfiguration("", id, "http://127.0.0.1:8765/mcp"), false);
  assert.equal(hasValidConfiguration("C:\\tunnel-client.exe", "no", "http://127.0.0.1:8765/mcp"), false);
});

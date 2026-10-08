import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettings } from "../src/types.ts";
import { classifyRuntimeExit } from "../src/runtime-diagnostics.ts";

test("settings migration accepts valid existing values and ignores unknown fields", () => {
  const result = normalizeSettings({ clientPath: " C:\\OpenAI\\tunnel-client.exe ", tunnelId: " test ", mcpUrl: "http://127.0.0.1:8765/mcp", autoConnect: false, chatgptLinked: true, apiKey: "NEVER_COPY_THIS" });
  assert.equal(result.clientPath, "C:\\OpenAI\\tunnel-client.exe");
  assert.equal(result.autoConnect, false); assert.equal(result.chatgptLinked, true);
  assert.equal("apiKey" in result, false); assert.equal(result.tunnelId, "test");
});
test("malformed saved settings cannot crash startup or silently disable the default", () => {
  for (const invalid of [null, undefined, "string", 42, []]) assert.equal(normalizeSettings(invalid).autoConnect, true);
  const result = normalizeSettings({ clientPath: 5, tunnelId: [], mcpUrl: null, autoConnect: "false", chatgptLinked: "true" });
  assert.equal(result.clientPath, ""); assert.equal(result.tunnelId, "");
  assert.equal(result.mcpUrl, "http://127.0.0.1:8765/mcp"); assert.equal(result.chatgptLinked, false);
});
test("unrelated digits in timestamps or keys do not create a false 401 or 429 diagnosis", () => {
  const failure = classifyRuntimeExit(1, "2026-10-08T05:59:43.401Z id=opaque429secret unexpected failure");
  assert.match(failure.message, /cause was not identified/);
  assert.doesNotMatch(failure.message, /opaque429|credentials or permissions|rate-limit/);
});
test("known auth/config errors require user action; network failures can retry", () => {
  assert.equal(classifyRuntimeExit(1, "HTTP 403 Forbidden").retryable, false);
  assert.equal(classifyRuntimeExit(1, "unknown flag: x").retryable, false);
  assert.equal(classifyRuntimeExit(1, "i/o timeout").retryable, true);
  assert.equal(classifyRuntimeExit(1, "HTTP 429 too many requests").retryable, true);
});

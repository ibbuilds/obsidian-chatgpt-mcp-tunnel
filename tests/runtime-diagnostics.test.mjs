import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeOutput, describeRuntimeExit, describeRuntimeSpawnError } from "../src/runtime-diagnostics.ts";

test("in-memory log collector keeps only a bounded tail and clears it after use", () => {
  const output = new RuntimeOutput();
  output.append("x".repeat(50000));
  output.append(Buffer.from(" fatal: access denied"));
  const tail = output.consume();
  assert.ok(tail.length <= 32768);
  assert.match(tail, /fatal: access denied$/);
  assert.equal(output.consume(), "");
});

test("unknown client failure does not echo secrets, URLs, paths, or raw logs", () => {
  const secret = "sk-SENSITIVE_RUNTIME_KEY_1234567890";
  const output = [
    "session=private-value",
    "Authorization: Bearer local-secret-token",
    "user=C:\\Users\\Jane\\Notes",
    "fatal: unknown operational problem",
    secret,
  ].join("\n");
  const description = describeRuntimeExit(1, output);
  assert.match(description, /exited with code 1/);
  for (const sensitive of [secret, "local-secret-token", "Jane", "session=private-value", "operational problem"]) {
    assert.equal(description.includes(sensitive), false);
  }
});

test("reports unsupported launch arguments instead of a generic exit code", () => {
  const description = describeRuntimeExit(1, "Error: unknown flag: --health.listen-addr");
  assert.match(description, /incompatible/);
  assert.match(description, /latest official client/);
});

test("identifies control-plane credential problems without echoing secret values", () => {
  const message = describeRuntimeExit(1, "error: poll failed HTTP 403 Authorization Bearer sk-123456SECRET");
  assert.match(message, /rejected.*credentials or permissions/i);
  assert.doesNotMatch(message, /SECRET|sk-123456/);
  assert.match(describeRuntimeExit(1, "401 Unauthorized"), /runtime API key/);
});

test("distinguishes cloudflared startup, health-port, TLS and connectivity failures", () => {
  assert.match(describeRuntimeExit(1, "failed to start cloudflared.exe"), /cloudflared/);
  assert.match(describeRuntimeExit(1, "listen tcp 127.0.0.1:8766: bind: address already in use"), /8766/);
  assert.match(describeRuntimeExit(1, "x509: certificate signed by unknown authority"), /TLS certificate/);
  assert.match(describeRuntimeExit(1, "lookup api.openai.com: no such host"), /network connection/);
});

test("gives useful Windows execution errors without showing filesystem paths", () => {
  assert.match(describeRuntimeSpawnError({ code: "ENOENT", path: "C:\\Users\\Secret\\tunnel-client.exe" }), /could not find/);
  assert.match(describeRuntimeSpawnError({ code: "EACCES" }), /blocked/);
  assert.equal(describeRuntimeSpawnError({ code: "EPERM" }).includes("Secret"), false);
});

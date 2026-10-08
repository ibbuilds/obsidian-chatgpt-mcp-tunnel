import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsSecretStore } from "../src/windows.ts";

test("Windows DPAPI protects the runtime key outside the vault", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-tunnel-secret-test-"));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = dir;
  try {
    const store = new WindowsSecretStore();
    const secret = "sk-test-not-a-live-api-key-0123456789012345";
    assert.equal(await store.hasKey(), false);
    await store.saveKey(secret);
    assert.equal(await store.hasKey(), true);
    const encrypted = await readFile(join(dir, "ObsidianMcpTunnel", "runtime-key.dpapi"), "utf8");
    assert.equal(encrypted.includes(secret), false);
    assert.equal(await store.readKey(), secret);
    await store.saveMcpToken("vault-local-test-token_1234567890");
    const encryptedMcpToken = await readFile(
      join(dir, "ObsidianMcpTunnel", "mcp-token.dpapi"), "utf8",
    );
    assert.equal(encryptedMcpToken.includes("vault-local-test-token_1234567890"), false);
    assert.equal(await store.readMcpToken(), "vault-local-test-token_1234567890");
    await assert.rejects(store.saveMcpToken("injected, Header: bad"), /bearer token/);
    await assert.rejects(store.saveMcpToken("bad\nheader"), /bearer token/);
    await store.forgetMcpToken();
    assert.equal(await store.hasMcpToken(), false);
    await store.forgetKey();
    assert.equal(await store.hasKey(), false);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

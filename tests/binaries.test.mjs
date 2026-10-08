import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCompleteInstallation, validateClientExecutable } from "../src/binaries.ts";

const pe = Buffer.alloc(600_000);
pe.write("MZ", 0, "ascii");

test("requires both official Windows executables side by side", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-mcp-binary-test-"));
  try {
    const client = join(dir, "tunnel-client.exe");
    const companion = join(dir, "cloudflared.exe");

    await assert.rejects(validateClientExecutable(client), /tunnel-client.exe/);
    assert.equal(await isCompleteInstallation(client), false);

    await writeFile(client, pe);
    await assert.rejects(validateClientExecutable(client), /cloudflared.exe/);
    assert.equal(await isCompleteInstallation(client), false);

    await writeFile(companion, pe);
    await assert.doesNotReject(validateClientExecutable(client));
    assert.equal(await isCompleteInstallation(client), true);

    await writeFile(companion, Buffer.from("not a Windows executable"));
    await assert.rejects(validateClientExecutable(client), /cloudflared.exe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a renamed client executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-mcp-binary-test-"));
  try {
    const invalidName = join(dir, "other.exe");
    await writeFile(invalidName, pe);
    await assert.rejects(validateClientExecutable(invalidName), /official tunnel-client.exe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

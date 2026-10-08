import assert from "node:assert/strict";
import test from "node:test";
import { selectWindowsRelease } from "../src/release.ts";

function sample() {
  const name = "tunnel-client-v0.0.16-windows-amd64.zip";
  return {
    tag_name: "v0.0.16",
    assets: [
      {
        name,
        browser_download_url: "https://github.com/openai/tunnel-client/releases/download/v0.0.16/" + name,
        digest: "sha256:" + "a".repeat(64),
        size: 28_000_000,
      },
      {
        name: "tunnel-client-v0.0.16-windows-arm64.zip",
        browser_download_url: "https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-windows-arm64.zip",
        digest: "sha256:" + "b".repeat(64),
        size: 25_000_000,
      },
    ],
  };
}

test("selects an exact platform archive", () => {
  const release = sample();
  const x64 = selectWindowsRelease(release, "amd64");
  assert.match(x64.url, /-windows-amd64.zip$/);
  assert.equal(x64.sha256, "a".repeat(64));
  assert.match(selectWindowsRelease(release, "arm64").url, /-windows-arm64.zip$/);
});

test("rejects missing digest and replaced download domains", () => {
  const release = sample();
  release.assets[0].digest = null;
  assert.throws(() => selectWindowsRelease(release, "amd64"), /verification/);
  release.assets[0].digest = "sha256:" + "a".repeat(64);
  release.assets[0].browser_download_url = "https://bad.example/tunnel-client.zip";
  assert.throws(() => selectWindowsRelease(release, "amd64"), /verification/);
});

test("rejects unexpected names, sizes, and tags", () => {
  const release = sample();
  release.assets[0].size = 100_000_000;
  assert.throws(() => selectWindowsRelease(release, "amd64"), /verification/);
  release.assets[0].size = 28_000_000;
  release.tag_name = "latest";
  assert.throws(() => selectWindowsRelease(release, "amd64"), /metadata/);
});

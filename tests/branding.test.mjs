import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readJson = (file) => JSON.parse(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
const readText = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("visible plugin identity is ChatGPT MCP Tunnel, not Obsidian", () => {
  const manifest = readJson("manifest.json");
  const appSource = readText("src/main.ts");

  assert.equal(manifest.id, "chatgpt-mcp-tunnel");
  assert.equal(manifest.name, "ChatGPT MCP Tunnel");
  assert.equal(manifest.version, "0.4.0");
  assert.doesNotMatch(manifest.name, /Obsidian/i);
  assert.match(appSource, /setName\("ChatGPT MCP Tunnel"\)/);
  assert.match(appSource, /name: "Connect"/);
  assert.match(appSource, /name: "Disconnect"/);
});

test("repository package includes both Obsidian and ChatGPT", () => {
  const manifest = readJson("manifest.json");
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");

  assert.equal(pkg.name, "obsidian-chatgpt-mcp-tunnel");
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.packages[""].version, pkg.version);
});

test("renamed plugin keeps the original encrypted Windows secrets accessible", () => {
  const win = readText("src/windows.ts");
  const readme = readText("README.md");

  assert.match(win, /"ObsidianMcpTunnel"/);
  assert.match(readme, /\.obsidian\/plugins\/chatgpt-mcp-tunnel\//);
  assert.match(readme, /Upgrade from v0\.3\.0/);
  assert.match(readme, /obsidian-chatgpt-mcp-tunnel\.git/);
});

test("client identity matches the plugin name and released version", () => {
  const source = readText("src/mcp-probe.ts");
  const version = readJson("manifest.json").version;
  assert.ok(source.includes('name: "chatgpt-mcp-tunnel", version: "' + version + '"'));
});

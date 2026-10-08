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
  assert.equal(manifest.version, "0.6.0");
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

test("connection UI uses a native right-sidebar view, never a blocking modal", () => {
  const app = readText("src/main.ts");
  const view = readText("src/connection-view.ts");

  assert.match(app, /addStatusBarItem\(\)/);
  assert.match(app, /registerView\(/);
  assert.match(app, /getRightLeaf\(true\)/);
  assert.match(app, /revealLeaf\(leaf\)/);
  assert.match(app, /new MutationObserver\(placeLast\)/);
  assert.match(view, /class ConnectionView extends ItemView/);
  assert.match(view, /new Setting\(root\)/);
  assert.match(view, /setName\("OpenAI tunnel client"\)/);
  assert.match(view, /setName\("Tunnel ID"\)/);
  assert.doesNotMatch(view, /\bextends\s+Modal\b/);
  assert.doesNotMatch(app, /new ConnectionModal/);
  assert.doesNotMatch(app, /setName\("Runtime API key"\)/);
});

test("responsive styling uses Obsidian theme variables and is included in release assets", () => {
  const stylesheet = readText("styles.css");
  const workflow = readText(".github/workflows/release.yml");
  assert.match(stylesheet, /\.chatgpt-mcp-tunnel-panel/);
  assert.match(stylesheet, /var\(--size-4-2\)/);
  assert.doesNotMatch(stylesheet, /#[0-9a-f]{3,8}\b/i);
  assert.match(workflow, /main\.js manifest\.json styles\.css/);
});

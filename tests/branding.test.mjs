import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
const json = (file) => JSON.parse(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
const text = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("plugin identity and release metadata stay consistent", () => {
  const manifest = json("manifest.json"), pkg = json("package.json"), lock = json("package-lock.json");
  assert.equal(manifest.id, "chatgpt-mcp-tunnel");
  assert.equal(manifest.name, "ChatGPT MCP Tunnel");
  assert.equal(pkg.name, "obsidian-chatgpt-mcp-tunnel");
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.ok(text("src/mcp-probe.ts").includes('version: "' + manifest.version + '"'));
});

test("UI is a dismissible popover, not another modal or panel", () => {
  const main = text("src/main.ts"), ui = text("src/connection-popover.ts");
  assert.match(main, /addStatusBarItem\(\)/);
  assert.match(main, /new ConnectionPopover/);
  assert.doesNotMatch(main, /registerView|getRightLeaf|new MutationObserver/);
  assert.match(ui, /root\.showPopover\(\)/);
  assert.match(ui, /"aria-modal", "false"/);
  assert.match(ui, /pointerdown/);
  assert.match(ui, /key\.key === "Escape"/);
  assert.doesNotMatch(ui, /extends Modal|extends ItemView/);
  assert.equal(existsSync(new URL("../src/connection-view.ts", import.meta.url)), false);
});

test("styling is scoped and secret storage survives upgrades", () => {
  assert.match(text("styles.css"), /\.cmt-popover/);
  assert.match(text("styles.css"), /var\(--background-primary\)/);
  assert.doesNotMatch(text("styles.css"), /#[0-9a-f]{3,8}\b/i);
  assert.match(text(".github/workflows/release.yml"), /main\.js manifest\.json styles\.css/);
  assert.match(text("src/windows.ts"), /"ObsidianMcpTunnel"/);
  assert.match(text("README.md"), /Upgrading from v0\.3\.0/);
});

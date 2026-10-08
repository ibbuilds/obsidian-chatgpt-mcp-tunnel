/** Runs production popover code in Chromium, with DOM-only Obsidian control doubles. */
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const candidates = process.platform === "win32"
  ? [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
  : [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = candidates.find((path) => path && existsSync(path));
if (!chrome) throw new Error("Set CHROME_PATH to a Chromium/Chrome executable to run the UI tests.");
const result = await build({
  entryPoints: ["src/connection-popover.ts"], bundle: true, write: false,
  platform: "browser", format: "iife", globalName: "CmtUI", target: "es2022",
  alias: { obsidian: resolve("tests/browser/obsidian-double.ts") },
});
const css = await readFile("styles.css", "utf8");
const fixture = await readFile("tests/browser/fixture.html", "utf8");
const assertions = await readFile("tests/browser/assertions.js", "utf8");
const html = fixture.replace("/*PLUGIN_STYLE*/", () => css)
  .replace("/*PLUGIN_BUNDLE*/", () => result.outputFiles[0].text)
  .replace("/*ASSERTIONS*/", () => assertions);
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "cmt-browser-test-"));
try {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1000,800", "--virtual-time-budget=5000", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Browser test timed out")); }, 40000);
    child.stdout.on("data", (data) => { stdout += data; if (stdout.length > 2_000_000) child.kill(); });
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", () => { clearTimeout(timeout); resolve(stdout || stderr); });
  });
  const report = output.match(/<pre\b[^>]*\bid="cmt-result"[^>]*>[\s\S]*?<\/pre>/)?.[0];
  if (!report || !/^<pre\b[^>]*\bdata-status="passed"/.test(report)) {
    throw new Error(report || "Browser did not finish the UI assertions: " + output.slice(-2000));
  }
  console.log(report.replace(/<[^>]*>/g, ""));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

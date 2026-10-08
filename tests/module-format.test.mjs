import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("TypeScript source imports without module-format warnings", () => {
  const sources = [
    "binaries", "release", "runtime-diagnostics", "types", "ui-model", "validation", "windows",
  ];
  const imports = sources.map((name) =>
    `import(${JSON.stringify(new URL(`../src/${name}.ts`, import.meta.url).href)})`);
  const child = spawnSync(process.execPath, [
    "--experimental-strip-types", "--input-type=module", "--eval",
    `await Promise.all([${imports.join(",")}]);`,
  ], { encoding: "utf8", timeout: 15_000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.doesNotMatch(child.stderr, /MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module/);
});

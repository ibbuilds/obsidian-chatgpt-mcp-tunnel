import assert from "node:assert/strict";
import test from "node:test";
import { firstScreen, popoverPosition, statusCopy } from "../src/ui-model.ts";

const complete = { client: true, key: true, vault: "running", token: false };
test("setup skips completed steps and never assumes ChatGPT registration", () => {
  assert.equal(firstScreen({ ...complete, client: false }, false, false), "client");
  assert.equal(firstScreen({ ...complete, key: false }, true, true), "account");
  assert.equal(firstScreen(complete, false, true), "account");
  assert.equal(firstScreen(complete, true, false), "chatgpt");
  assert.equal(firstScreen(complete, true, true), "home");
  for (const vault of ["missing", "stopped", "authentication"]) {
    assert.equal(firstScreen({ ...complete, vault }, true, true), "client");
  }
});

test("position is attached above the status item, right-aligned, without moving the editor", () => {
  const p = popoverPosition({ left: 1090, right: 1186, top: 775, bottom: 798 }, 368, 360, 1200, 800);
  assert.equal(p.left, 818);
  assert.equal(p.top, 407);
});

test("popover stays inside small viewports and can open below a top anchor", () => {
  for (const w of [280, 350, 620, 1200]) for (const h of [300, 420, 800]) {
    for (const top of [0, 30, h - 25]) {
      const p = popoverPosition({ left: w - 100, right: w, top, bottom: top + 20 }, 368, 600, w, h);
      assert.ok(p.left >= 12 && p.top >= 12);
      assert.ok(p.left + p.width <= w - 12);
      assert.ok(p.top <= h - 12);
      assert.equal(p.maxHeight, h - 24);
    }
  }
  assert.equal(popoverPosition({ left: 0, right: 100, top: 0, bottom: 24 }, 368, 200, 1200, 800).top, 32);
});

test("status distinguishes ready, stopped, errors and external processes", () => {
  const copy = (state, detail = "Check local settings") => statusCopy({ state, detail, managed: state === "connected" });
  assert.equal(copy("connected").title, "Tunnel ready");
  assert.equal(copy("stopped").action, "Connect");
  assert.equal(copy("connecting").action, "Cancel");
  assert.equal(copy("existing-runtime").title, "Another client is running");
  assert.equal(copy("error", "Not authorized").text, "Not authorized");
  assert.equal(copy("not-configured").action, "Continue setup");
});

import assert from "node:assert/strict";
import test from "node:test";
import { firstScreen, popoverPosition, statusCopy, connectionChecks, connectionIndicator, needsLocalRepair } from "../src/ui-model.ts";

const complete = { client: true, key: true, vault: "running", token: false };
test("setup skips completed steps and never assumes ChatGPT registration", () => {
  assert.equal(firstScreen({ ...complete, client: false }, false, false), "client");
  assert.equal(firstScreen({ ...complete, key: false }, true, true), "account");
  assert.equal(firstScreen(complete, false, true), "account");
  assert.equal(firstScreen(complete, true, false), "chatgpt");
  assert.equal(firstScreen(complete, true, true), "home");
  for (const vault of ["missing", "stopped", "authentication"]) {
    assert.equal(firstScreen({ ...complete, vault }, true, false), "client");
  }
});
test("an existing configured connection stays on recovery when its local server stops", () => {
  assert.equal(firstScreen({...complete,vault:"stopped"},true,true),"home");
  assert.equal(firstScreen({...complete,vault:"stopped",key:false},true,true),"client");
});
test("the two essential checks identify a local server failure while its tunnel still responds", () => {
  const state={state:"waiting-for-obsidian",managed:true,detail:"Local MCP unavailable"};
  const health=connectionChecks(state,complete);
  assert.equal(health.tunnel.value,"Listo");assert.equal(health.tunnel.tone,"ok");
  assert.equal(health.server.value,"No disponible");assert.equal(health.server.tone,"warning");
  assert.equal(statusCopy(state).action,"Reparar conexión");
  assert.equal(connectionChecks({...state,managed:false},complete).tunnel.value,"Desconectado");
});
test("setup detection alone never becomes a live ready check", () => {
  const stopped=connectionChecks({state:"stopped",managed:false,detail:"Stopped"},complete);
  assert.equal(stopped.server.value,"Detectado");assert.equal(stopped.server.tone,"neutral");
  const error=connectionChecks({state:"error",managed:false,detail:"Rejected"},complete);
  assert.equal(error.tunnel.tone,"error");assert.notEqual(error.server.tone,"ok");
  const live=connectionChecks({state:"connected",managed:true,detail:"Ready"},complete);
  assert.equal(live.server.tone,"ok");assert.equal(live.tunnel.tone,"ok");
  const inspectedFailure=connectionChecks({state:"connected",managed:true,detail:"Ready"},{...complete,vault:"stopped"});
  assert.equal(inspectedFailure.server.tone,"warning");
  assert.equal(needsLocalRepair({state:"connected",managed:true,detail:"Ready"},{...complete,vault:"stopped"}),true);
});
test("the compact indicator uses shape and semantic colour and never marks a failed connection ready", () => {
  assert.deepEqual(connectionIndicator({state:"connected",managed:true,detail:"Ready"}),{icon:"plug-zap",tone:"ok"});
  for(const state of ["stopped","starting","connecting","stopping","error","waiting-for-obsidian","existing-runtime","not-configured"]){
    assert.notEqual(connectionIndicator({state,managed:false,detail:""}).tone,"ok");
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
  assert.equal(copy("connected").title, "Disponible");
  assert.equal(copy("stopped").action, "Conectar");
  assert.equal(copy("connecting").action, "Cancelar");
  assert.equal(copy("existing-runtime").title, "Cliente en uso");
  assert.match(copy("error", "Not authorized").text, /detalle del fallo/);
  assert.equal(copy("not-configured").action, "Configurar");
});

(async () => {
  const out = document.createElement("pre"); out.id = "cmt-result"; out.hidden = true; document.body.appendChild(out);
  const results = [];
  const ok = (value, message) => { if (!value) throw new Error(message); results.push(message); };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const button = (text) => [...document.querySelectorAll('.cmt-popover button')].find((b) => b.textContent === text || b.getAttribute("aria-label") === text);
  const type = (label, value) => {
    const input = document.getElementById([...document.querySelectorAll("label")].find((l) => l.textContent === label).htmlFor);
    input.focus(); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); return input;
  };
  try {
    const before = document.querySelector("main").getBoundingClientRect().width;
    const trigger = document.getElementById("trigger");
    trigger.click(); await settle();
    let popup = document.querySelector(".cmt-popover");
    ok(popup?.dataset.screen === "client", "First incomplete step is shown");
    ok(popup.getAttribute("aria-modal") === "false", "Popover is non-modal");
    ok(document.querySelector("main").getBoundingClientRect().width === before, "The editor width does not change");
    const box = popup.getBoundingClientRect();
    ok(box.bottom <= trigger.getBoundingClientRect().top, "Popover is above its anchor");
    button("Find existing client").click(); await settle();
    button("Continue").click(); await settle();
    ok(document.querySelector(".cmt-popover").dataset.screen === "account", "Only the OpenAI details screen follows");
    type("Tunnel ID", "tunnel_" + "a".repeat(32));
    const secret = type("Runtime API key", "sk-fake-test-only-1234567890");
    window.pop.updateConnection();
    ok(document.activeElement === secret && secret.value.length > 0, "Status updates preserve typing and focus");
    window.failSave = true; button("Save & connect").click(); await settle();
    ok(document.querySelector(".cmt-feedback.is-error")?.textContent.includes("could not save"), "Errors appear inline");
    ok(secret.value.length > 0, "A failed save preserves the form");
    window.failSave = false; button("Save & connect").click(); await settle();
    ok(document.querySelector(".cmt-popover").dataset.screen === "chatgpt", "ChatGPT registration is a separate explicit step");
    button("I've already added this tunnel").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel ready", "Daily view is compact");
    button("Disconnect").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel stopped", "Disconnect changes the real state");
    button("Connect").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel ready", "Connect changes the real state");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok(!document.querySelector(".cmt-popover") && document.activeElement === trigger, "Escape dismisses and restores focus");
    for (let i = 0; i < 15; i++) { trigger.click(); await settle(); trigger.click(); }
    ok(!document.querySelector(".cmt-popover"), "Repeated toggles leave no duplicates");
    trigger.click(); await settle();
    document.getElementById("editor").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    ok(!document.querySelector(".cmt-popover"), "Clicking the editor dismisses without a backdrop");
    trigger.click(); await settle();
    document.body.classList.add("light");
    ok(getComputedStyle(document.querySelector(".cmt-popover")).backgroundColor === "rgb(255, 255, 255)", "Native theme variables change the surface");
    button("Close").click();
    out.dataset.status = "passed"; out.textContent = `${results.length} browser interaction checks passed.\n` + results.join("\n");
  } catch (error) {
    out.dataset.status = "failed"; out.textContent = error.stack || String(error);
  }
})();

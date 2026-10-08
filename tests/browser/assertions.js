(async () => {
  const out = document.createElement("pre"); out.id = "cmt-result"; out.hidden = true; document.body.appendChild(out);
  const results = [];
  const ok = (value, message) => { if (!value) throw new Error(message); results.push(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  const button = text => [...document.querySelectorAll('.cmt-popover button')].find(b => b.textContent === text || b.getAttribute("aria-label") === text);
  const type = (label, value) => {
    const el = [...document.querySelectorAll(".cmt-popover label")].find(l => l.textContent === label);
    const input = document.getElementById(el.htmlFor);
    input.focus(); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); return input;
  };
  const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
  try {
    const before = document.querySelector("main").getBoundingClientRect().width;
    const trigger = document.getElementById("trigger");
    trigger.click(); await settle();
    let popup = document.querySelector(".cmt-popover");
    ok(popup?.dataset.screen === "client", "First incomplete setup step is shown");
    ok(popup.getAttribute("aria-modal") === "false", "Popover remains non-modal");
    ok(document.querySelector("main").getBoundingClientRect().width === before, "Editor width never changes");
    ok(popup.getBoundingClientRect().bottom <= trigger.getBoundingClientRect().top, "Popover sits above the status indicator");
    ok(popup.textContent.includes("tunnel-client.exe, not cloudflared.exe"), "File choice is explained without another tutorial");
    button("Find existing client").click(); await settle(); button("Continue").click(); await settle();
    ok(document.querySelector(".cmt-popover").dataset.screen === "account", "Account details follow the selected client");
    ok(button("Save & connect").disabled, "Incomplete account details cannot be submitted");
    type("Tunnel ID", "tunnel_" + "a".repeat(32));
    const secret = type("Runtime API key", "sk-fake-test-only-1234567890");
    window.pop.updateConnection();
    ok(document.activeElement === secret && secret.value.length > 0, "Background health updates preserve typing and focus");
    button("Show runtime api key").click();
    ok(secret.type === "text", "API key visibility can be explicitly toggled");
    button("Hide runtime api key").click();
    ok(secret.type === "password", "API key can be hidden again");
    window.failSave = true; button("Save & connect").click(); await settle();
    ok(document.querySelector(".cmt-feedback.is-error")?.textContent.includes("could not save"), "Save failures display an actionable inline error");
    ok(secret.value.length > 0, "Failed saves preserve the entered key");
    type("Tunnel ID", "bad-id");
    ok(button("Save & connect").disabled, "Validation remains effective after a failed save");
    type("Tunnel ID", "tunnel_" + "a".repeat(32));
    window.failSave = false;
    secret.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle();
    ok(document.querySelector(".cmt-popover").dataset.screen === "chatgpt", "Enter saves once and proceeds to ChatGPT registration");
    button("I've already added this tunnel").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel ready", "Completed setup opens the compact daily view");
    button("Disconnect").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel stopped", "Disconnect changes the host state");
    button("Connect").click(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel ready", "Reconnect changes the host state");

    button("Connection settings").click(); button("Edit OpenAI details").click();
    button("Replace").click(); type("Runtime API key", "sk-replacement-draft-only");
    button("Keep saved key").click();
    ok(document.querySelector(".cmt-saved")?.textContent.includes("saved securely"), "Cancelling key replacement keeps the existing key");
    ok(!button("Save & connect").disabled, "Keeping the saved key does not require another secret");
    button("Back").click();
    let advanced = document.querySelector("details.cmt-advanced"); advanced.open = true;
    const local = type("Local endpoint", "http://127.0.0.1:8888/mcp");
    button("Edit OpenAI details").click(); button("Back").click();
    advanced = document.querySelector("details.cmt-advanced"); advanced.open = true;
    ok([...document.querySelectorAll("input")].some(i => i.value === local.value), "Local endpoint drafts survive navigation between settings screens");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok(!document.querySelector(".cmt-popover") && document.activeElement === trigger, "Escape dismisses and restores the status indicator focus");
    for (let i = 0; i < 15; i++) { trigger.click(); await settle(); trigger.click(); }
    ok(!document.querySelector(".cmt-popover"), "Repeated toggles do not duplicate the popover");
    trigger.click(); await settle();
    document.getElementById("editor").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    ok(!document.querySelector(".cmt-popover"), "Editor clicks dismiss without a blocking backdrop");
    trigger.click(); await settle(); document.body.classList.add("light");
    ok(getComputedStyle(document.querySelector(".cmt-popover")).backgroundColor === "rgb(255, 255, 255)", "Light theme uses Obsidian surface variables");
    button("Close").click(); document.body.classList.remove("light");

    // ChatGPT settings should be reachable even while the local runtime is offline.
    window.reset("chatgpt");
    host.snapshot = { state: "error", detail: "Control-plane authorization denied", managed: false };
    trigger.click(); await settle();
    ok(button("Open ChatGPT ↗") && !button("Open ChatGPT ↗").disabled, "ChatGPT settings link stays available when the tunnel is offline");
    button("Close").click();

    const inspect = host.inspect, gate = deferred(); host.inspect = () => gate.promise;
    trigger.click(); button("Close").click(); host.inspect = inspect;
    window.reset("home"); trigger.click(); await settle(); gate.resolve({ client: false, key: false, token: false, vault: "missing" }); await settle();
    ok(document.querySelector(".cmt-popover").dataset.screen === "home", "Stale inspection does not overwrite a reopened popover");
    button("Close").click();

    window.reset("account"); trigger.click(); await settle();
    type("Tunnel ID", "tunnel_" + "b".repeat(32)); type("Runtime API key", "sk-only-a-test-value-123456");
    const save = host.saveAccount, pending = deferred(); let connected = 0;
    const connect = host.connect;
    host.saveAccount = async (id, key) => { await pending.promise; await save(id, key); };
    host.connect = async () => { connected++; await connect(); };
    button("Save & connect").click(); button("Close").click(); pending.resolve(); await settle();
    ok(connected === 1 && !document.querySelector(".cmt-popover"), "Save-and-connect completes once even if the popover is dismissed");
    host.saveAccount = save; host.connect = connect;

    window.reset("home"); host.snapshot = { state: "stopped", detail: "Stopped", managed: false };
    const connecting = deferred(); host.connect = async () => { host.snapshot = { state: "starting", detail: "Checking…", managed: false }; window.pop.updateConnection(); await connecting.promise; };
    trigger.click(); await settle(); button("Connect").click(); await settle();
    ok(button("Cancel") && !button("Cancel").disabled, "Cancel stays enabled during an asynchronous startup");
    button("Cancel").click(); connecting.resolve(); await settle();
    ok(document.querySelector(".cmt-title").textContent === "Tunnel stopped", "Cancellation cannot be undone by late UI work");
    host.connect = connect; button("Close").click();

    window.reset("account"); trigger.click(); await settle();
    const shown = type("Runtime API key", "sensitive-draft-for-removal"); button("Show runtime api key").click();
    button("Close").click();
    ok(shown.value === "", "Dismissal clears secrets even while the input is revealed");
    out.dataset.status = "passed"; out.textContent = `${results.length} browser interaction checks passed.\n` + results.join("\n");
  } catch (error) { out.dataset.status = "failed"; out.textContent = error.stack || String(error); }
})();

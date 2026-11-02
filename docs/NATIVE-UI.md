# Native Obsidian UI

The ChatGPT and Source Scraper popovers share Obsidian's interface font, semantic colours, native ButtonComponent/TextComponent/ToggleComponent controls, 360px width, 28px icon buttons, 8px/12px header padding and native border/radius/shadow tokens. There are no additional fonts, fixed colours, gradients, tinted icon tiles or secondary app shell.

The ChatGPT status item reads **ChatGPT** with a fixed-size native icon. Shape, semantic colour, accessible name and tooltip convey state without expanding the label. The main screen exposes two essential checks: local tunnel and MCP server. Healthy states need no explanatory heading. Ready opens ChatGPT; the test entry is **Probar conexión**. A failed local server offers repair directly. Background inspections cannot replace newer failures with stale success.

Safe failure details are one disclosure away on the main screen. Advanced diagnostics retain tool counts, the user's registration acknowledgement and startup preference. Detected setup metadata is neutral; it never alone makes a live check green. Previously configured connections with a stopped server open recovery instead of first-run setup. Repair prevents double submission, and registration/test remain available offline. Keys stay masked and drafts clear on dismissal.

Validation: typecheck, 72 runtime/unit checks and 48 browser interaction checks. Seven local scenarios in genuine isolated Obsidian cover the two visible checks, compact indicator, direct repair, failure details, stable status width, native surface consistency, light/dark at 1440/768/390px and unchanged fixture notes. Simulated connection states do not certify live account connectivity or comparative user-tested usability.

The installed 0.9.0 functionality was preserved as a separate baseline checkpoint before the UI change. No transport, key storage, authorization or note-writing implementation was changed by the UI commit.

# Native Obsidian UI

The ChatGPT and Source Scraper popovers share Obsidian's interface font, semantic colours, native ButtonComponent/TextComponent/ToggleComponent controls, 360px width, 28px icon buttons, 8px/12px header padding and native border/radius/shadow tokens. There are no additional fonts, fixed colours, gradients, tinted icon tiles or secondary app shell.

The ChatGPT status item always reads **ChatGPT**. Connection state is available in the accessible name, tooltip and popover. The main screen contains local readiness, one sentence, one action and the ChatGPT test entry. Ready opens ChatGPT; incomplete setup continues at the first missing step; connecting remains cancellable; stopping disables resubmission. Disconnect and repair remain in Options.

Diagnostics include the safe existing runtime detail, local tools, the user's ChatGPT-registration acknowledgement and startup preference. They stay collapsed and do not label remote ChatGPT access verified. Registration and test remain available when local connectivity fails. Client selection alternatives are collapsed during first-run automatic setup. Keys stay masked, in-memory drafts clear on dismissal, and the existing encrypted store is preserved.

Validation: typecheck, 68 runtime/unit checks and 42 browser interaction checks. Additional local acceptance loads both production plugins in genuine isolated Obsidian, uses simulated connection states, compares their computed native font/surface/radius, checks navigation and failure recovery, captures light/dark at 1440/768/390px and verifies unchanged fixture notes. These simulated checks do not contact the owner's real account or certify live tunnel connectivity.

The installed 0.9.0 functionality was preserved as a separate baseline checkpoint before the UI change. No transport, key storage, authorization or note-writing implementation was changed by the UI commit.

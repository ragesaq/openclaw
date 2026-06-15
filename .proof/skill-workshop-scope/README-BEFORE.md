# Skill Workshop empty-render bug — BEFORE proof (v2026.6.8-beta.1)

## What this proves
The Skill Workshop view in stock OpenClaw **v2026.6.8-beta.1** (`43d00c7`) renders an empty
"No proposals yet — *Agent* hasn't drafted any skill proposals" state for **every** agent and
across **every** UI toggle, even though proposals exist on disk.

The 2026.6.8 update did NOT fix the bug. The UI was reworked (new **Board / Today** mode switch
and a **Use current chat** toggle) but there is still no all-agents/Global scope, and the per-agent
view never populates from the proposal store.

## Ground truth (data exists)
`~/.openclaw/skill-workshop/proposals` holds **22 proposals** (14 applied, 7 pending, 1 stale).
Chisel alone owns 4. The UI shows none of them.

## The animation (`skill-workshop-before-3toggles.gif`)
Six verified live states, each confirmed via DOM read before capture, every one empty:

| # | Agent   | Mode  | Use current chat | Result |
|---|---------|-------|------------------|--------|
| 1 | Chisel  | Board | off              | No proposals yet — Chisel hasn't drafted… |
| 2 | Chisel  | Today | ON               | No proposals yet — Chisel hasn't drafted… |
| 3 | Forge   | Today | ON               | No proposals yet — Forge hasn't drafted… |
| 4 | Forge   | Board | off              | No proposals yet — Forge hasn't drafted… |
| 5 | Compass | Board | off              | No proposals yet — Compass hasn't drafted… |
| 6 | Compass | Today | ON               | No proposals yet — Compass hasn't drafted… |

Covers all three UI dimensions the user named (Use current chat / Board / Today) across three
agents. The empty card's subtitle tracks the selected agent, confirming the scope switches —
the list just never populates.

## Capture method (why stepped, not streamed)
Streamed CDP frame capture (`capture.js`) produced misleading frames: the workshop tab is
backgrounded, so the browser **throttles compositing**. The DOM updated immediately on each
agent switch (verified via `Runtime.evaluate`), but the streamed *paint* lagged 20–30s, so a
naive 40–75s recording showed only the first agent(s) and dropped Compass entirely.

Fix: each state is set via the real UI controls, **confirmed via DOM read**, then captured with a
single settled live screenshot (`shot.js`, with `Emulation.setFocusEmulationEnabled` + bringToFront).
Six verified PNGs in `steps/` are stitched into a looping GIF with short crossfades.

## Files
- `skill-workshop-before-3toggles.gif` — the deliverable (1120×700, ~9.3s loop, 1.79 MB)
- `steps/s1..s6_*.png` — the six verified source screenshots
- `steps_sheet.png` — labeled contact sheet of all six states
- `shot.js` / `capture_focus.js` — capture helpers

## Next: AFTER
Apply the Global-scope fix on this same 2026.6.8 build and capture the proposals populating —
the half that shows why the fix is needed.

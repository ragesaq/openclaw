# Skill Workshop scope fix — AFTER proof (patched v2026.6.8-beta.1)

## What this proves
With the **Global / Selected-agent scope** fix applied on the **same** gateway version as the
BEFORE capture (`v2026.6.8-beta.1`), the Skill Workshop now **populates** across every scope and
agent. Same version, same data, one commit of difference — the empty state is gone.

The fix adds a `scope` param to the `skills.proposals.*` RPCs and a **Global / Selected agent**
tablist to the workshop header. Global asks the gateway to span every agent workspace in one call;
Selected agent pins the nav-selected agent.

## The animation (`skill-workshop-after-3scopes.gif`)
Six verified live states (1440×900 source, each DOM-confirmed before capture), every one populated:

| # | Scope                  | View          | Result |
|---|------------------------|---------------|--------|
| 1 | Global                 | Board · All   | **22 proposals** — every agent, one view |
| 2 | Global                 | Board · Applied | **14** live skills in use |
| 3 | Global                 | Today         | **7** proposals waiting + collection (14 in use) |
| 4 | Selected agent: Anvil  | Board · All   | **11** — scoped to one workspace |
| 5 | Selected agent: Chisel | Board · All   | **5**  — scoped to one workspace |
| 6 | Selected agent: Forge  | Board · All   | **3**  — scoped to one workspace |

Global 22 = Anvil 11 + Chisel 5 + Forge 3 + Pylon 3. Per-agent scoping returns the real subset,
proving the scope switch is genuine (not "always show everything"). The new toggle is visible
top-right in every frame; the version badge reads `v2026.6.8-beta.1` throughout.

Contrast with the BEFORE (`skill-workshop-before-3toggles.gif`): identical version, all six states
"No proposals yet — *Agent* hasn't drafted any skill proposals" while 22 proposals sat on disk.

## How the AFTER was produced (honest methodology)
Isolated patched instance — **no production files touched, prod gateway untouched**.

1. **Fix source:** `fix/skill-workshop-global-scope` (single commit `5794647e49`) cherry-picked
   clean onto the `v2026.6.8-beta.1` tag → branch `fix/skill-workshop-scope-2668`. 7 of 8 core
   files applied verbatim; `ui/src/ui/app-render.ts` auto-merged (no conflicts).
2. **Build:** `pnpm ui:build` produced a patched `dist/control-ui` carrying the `sw-scope-switch`
   toggle (verified present in the bundle). Server runs from the patched TypeScript source.
3. **Isolated gateway:** booted from the worktree with
   `OPENCLAW_STATE_DIR=<throwaway>` `OPENCLAW_GATEWAY_PORT=18793` `OPENCLAW_SKIP_CHANNELS=1`.
   Config is a 5-agent local-mode stub (anvil/chisel/forge/pylon/compass) whose workspace dirs are
   the **real** `workspace-council/<agent>` paths, so agent-scoping filters against the real data.
4. **Real data:** the **real** proposal store (`~/.openclaw/skill-workshop`, 22 proposals:
   14 applied / 7 pending / 1 stale) was **copied** physically into the isolated state dir so all
   reads stay inside the workspace root. (An initial symlink tripped fs-safe's realpath check —
   "file is outside workspace root" — an artifact of the symlink, not the fix; the physical copy
   resolves it. Prod has the store physically under home, so prod never hits this.)
5. **Capture:** each state set via the real UI controls, confirmed via DOM read (tab counts +
   selected agent), then a single settled live screenshot (`shot.js`, focus-emulation + bringToFront)
   — the same trustworthy method used for the BEFORE, because backgrounded-tab compositor throttling
   makes streamed capture lag.

## Files
- `skill-workshop-after-3scopes.gif` — deliverable (1120×700, ~10.4s loop, ~2.0 MB)
- `after-steps/a1..a6_*.png` — six verified 1440×900 source screenshots
- `after_sheet.png` — labeled contact sheet of all six states
- `encode_after.py` / `shot.js` — capture + encode helpers

## Pairing
- BEFORE: `README.md` (this dir) + `skill-workshop-before-3toggles.gif`
- AFTER:  this file + `skill-workshop-after-3scopes.gif`

# Skill Workshop scope fix — before/after proof

Branch: `fix/skill-workshop-global-scope` (fork `ragesaq/openclaw`, base `origin/main` `f1b8827`)
Surface: live Control UI, gateway `v2026.6.6`, headless Chromium, 1440×900.

## The bug (multi-agent only)
The workshop `skills.proposals.list` call sends empty params `{}`. The server backfills
the **default agent** (here: `relay`) and filters proposals to that agent's workspace.
On a multi-agent install the default agent owns ~0 proposals, so the page is blank for
every agent. A single-agent install never hits this: the default agent *is* the only
agent, so its workspace contains every proposal and the page renders normally.

Live confirmation (real RPC against the running server):
- `skills.proposals.list { agentId: "chisel" }` -> 4
- `{ agentId: "anvil" }` -> 11, `forge` -> 3, `pylon` -> 3, `relay` -> 0
- `{}` (what the UI actually sends) -> **0**  (resolves to relay)
- manifest total -> **21**

## Screenshots
- `before-01-relay-default-blank.png` — default agent relay, "No proposals yet / Relay hasn't drafted any".
- `before-02-chisel-selected-still-blank.png` — agent switched to Chisel (owns 4); still blank ("Chisel hasn't drafted any"). The selected agent never reaches the list call; only the empty-state label tracks it.
- `after-01-board-populated-pending7.png` — board rendering, Pending (7) with working detail panel + Apply/Revise/Reject.
- `after-02-global-all21.png` — **Global scope**: All **21** proposals across every agent (Today 2 / Yesterday 2 / Earlier 17).
- `after-03-selected-agent-chisel-4.png` — **Selected agent** scope: Chisel's **4** proposals.

## After-state methodology (honest)
The PR has server + UI changes; the live server doesn't yet carry the new `scope`
param, so the AFTER was produced on the live UI without redeploying production:
- The live server **already** honors `agentId` (unchanged by this PR). Selected-agent
  rendering (`after-03`) is byte-faithful: the real loader fetched `{ agentId: "chisel" }`
  through the real client and the real render pipeline normalized + displayed it.
- Global (`after-02`) is the union the PR's `scope:"global"` returns in one server call.
  Live, that single call isn't available, so the union was assembled via per-agent calls
  on the unmodified server and fed through the same real loader/render path. The rendered
  result is identical to the PR's global mode.
- End-to-end server+UI is covered by 23 passing tests on `origin/main` (global
  list/inspect/apply across workspaces + i18n parity).

No production files were changed and the gateway was not restarted; the demonstration
lived entirely in the headless browser page and is gone on reload.

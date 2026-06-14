# Hidden channel assistant commentary proof

## Real environment

- OpenClaw gateway built from branch `fix/channel-hidden-commentary` and restarted on `2026-06-11T15:31Z`.
- ClickClack bridge subscribed to the real channel session `agent:chisel:clickclack:channel:channel:chn_01ktq4zg9bga4dqrycqz67jts6`.
- Model path tested with GPT-5.5 channel-originated turns.

## Before

On channel-originated ClickClack turns, tool events were flowing but hidden assistant commentary was not mirrored to session-message subscribers. ClickClack could not build a preamble from assistant commentary for those runs.

## After

The patched gateway emitted hidden assistant commentary frames to the exact session-message subscribers, and ClickClack persisted/rendered them as durable `agent_commentary` rows alongside `agent_tool` rows.

Observed durable rows in the ClickClack DB after deploy included:

- `2026-06-11T15:55:29.371130227Z`, `kind=agent_commentary`, body `Pushed (6055c05). Posting the summary to the channel.`
- `2026-06-11T15:55:21.602563769Z`, `kind=agent_tool`, body beginning `**exec**`
- `2026-06-11T15:55:41.92467386Z`, `kind=agent_tool`, body beginning `**message**`

User-visible screenshots:

- `before-real-user-channel-proof.png`: ragesaq's channel-originated ClickClack turn before this gateway patch. The final assistant answer is visible, but no preamble with commentary/tool progress appears for that long-running turn.
- `after-real-user-channel-proof.png`: ragesaq's channel-originated ClickClack turn after this gateway patch. The expanded preamble contains assistant commentary interleaved with tool-call rows.
- `preamble-expanded-commentary-tools.png`: ClickClack shows an expanded live preamble containing commentary interleaved with tool-call rows.
- `preamble-collapsed-final-visible.png`: ClickClack shows the preamble collapsed while the final assistant answer remains visible.

## After (animated)

![Progress surface building live in a hidden channel run](./after-progress-surface-building-animated.gif)

`after-progress-surface-building-animated.gif`: a live capture of the progress surface populating mid-turn on a channel-typed (hidden) run. Commentary prose, tool-call rows, and the status chip build down the channel in real time as the turn executes, exactly the behavior the gateway patch restores for session-message subscribers. Captured at ~7.7 fps and encoded to a looping GIF (760x489).

Caveat: this clip is a real hidden-channel turn captured live, but it is the surface populating during another agent's in-flight turn observed in the same browser, not a single scripted prompt. It demonstrates the mirrored commentary/tool progress rendering live; it is not a controlled before/after pair. The controlled main-vs-patched pair is captured separately via the still PNGs above.

## Limitations

This proof is from a production-like local ClickClack bridge deployment rather than an upstream-maintainer-hosted environment. It exercises the affected hidden/channel session routing path that was broken.

# ClickClack progress surface — before / after

Canonical before/after for the channel-hidden-commentary work, recorded on **clickclack-stock** (not clickglass). This is the surface the migration targets: the first-party ClickClack server, driven through OpenClaw's native `clickclack` channel.

## What this proves

Stock ClickClack shows you the agent's final message and nothing else. While an agent works a turn, the channel gives no view of the tool steps or commentary happening server-side. The progress producer captures that in-flight activity as a durable **PREAMBLE** panel attached to the agent message — one row per step — that a reader can expand to see exactly what the agent did.

- **Before:** agent is working, the channel shows only the user's message; the reply lands with no record of the work behind it.
- **After:** the agent message carries a `PREAMBLE` panel; expand it and every `exec` step the agent ran is listed in order, followed by the final reply.

## Controlled setup (one variable)

A second, isolated stock install was stood up specifically as the source lab, so captures run uncontended and production (`:8100`) is never touched:

- **Instance:** `clickclack-stock` on `127.0.0.1:8101`, own data dir, byte-identical binary, isolated SQLite.
- **Channel:** native OpenClaw `clickclack` channel, `src` account → `:8101` (additive; the `:8100` default account is untouched).
- **The only variable between the two runs is the progress producer bridge:** off for _before_, on for _after_. Same instance, same channel, same prompt shape.

Prompt used (read-only, tool-heavy so the surface has several steps to show):

> Fresh read-only check: run each as its own separate exec step so progress builds visibly, then reply with a short summary: (1) `ls -la` the clickclack-stock-src data dir, (2) the stock binary `--version`, (3) `du -h` the data DB, (4) `wc -l` serve.log, (5) `tail -3` of serve.log.

## Capture method

- **Resolution:** the channel is rendered at a desktop viewport (1280×860 logical) at 2× device-scale, so the UI fills properly and text is crisp (the earlier pass was a cramped mobile viewport).
- **Recording starts before the message:** capture is already rolling on the empty channel when the prompt is sent, so the opening frames show the channel at rest, then the prompt landing, then the surface building — nothing at the start is missed.
- **Timing by database:** the capture watches the `:8101` SQLite store for the whole turn, tracking two things — how many durable progress rows have landed, and whether the agent's reply row has landed — and keeps recording until the reply is in frame, then holds a few seconds past it.
- **Build by row, not one snap:** stock ClickClack does not push these rows to an already-open tab over its websocket; each row is durable and renders on channel load/refetch. So the capture refetches each time a new progress row lands. Stitched together, that shows the PREAMBLE accumulating one step at a time — the real-time arc of the work — instead of popping in fully formed at the end.

## Before — stock ClickClack, no progress producer

The message is sent and the channel just sits. No preamble, no tool rows, then the reply appears with no record of the work behind it.

![Before: blank channel while the agent works, then a bare reply with no progress surface](clickclack-before-blank-no-progress.gif)

## After — progress producer on

Same prompt. The agent message now carries a `PREAMBLE` panel that builds in real time: one `exec` row appears for each step as the agent runs it, accumulating into the full record ahead of the final reply.

![After: the agent message grows a PREAMBLE panel that builds one exec row at a time as each durable progress row lands, then the final reply](clickclack-after-preamble-building.gif)

Frame-sampled arc of the same run (empty → prompt → preamble builds 1 → 3 → 5 steps → final reply):

![After contact sheet: empty channel, prompt sent, preamble building from one to five steps, then the reply](clickclack-after-contactsheet.png)

The progress surface in full at the end of the turn — the durable record of every step, above the reply:

![Expanded PREAMBLE: five exec rows above the final reply](clickclack-after-expanded-preamble.png)

## The actual after transcript

What the channel rendered, in order (durable rows, real turn `#061455`):

1. **user** — the read-only check prompt
2. **agent_tool** — `exec` · `ls -la /home/lumadmin/.openclaw/clickclack-stock-src/data`
3. **agent_tool** — `exec` · `/home/lumadmin/.openclaw/clickclack-stock-src/clickclack-stock-bin --version`
4. **agent_tool** — `exec` · `du -h /home/lumadmin/.openclaw/clickclack-stock-src/data/clickclack.db`
5. **agent_tool** — `exec` · `wc -l /home/lumadmin/.openclaw/clickclack-stock-src/serve.log`
6. **agent_tool** — `exec` · `tail -3 /home/lumadmin/.openclaw/clickclack-stock-src/serve.log`
7. **agent_tool** — `message` · the `send` of the final reply
8. **message** — final reply:

> Run #061455 done (read-only, 5 steps):
>
> 1. data/ — clickclack.db (569344 B) + active WAL/SHM (wal 4.1M, shm 32K) + logs/ and uploads/ dirs. Mtime on db 03:24, wal/shm 04:01 (live writes).
> 2. --version — not defined. Binary rejects -version flag; it's the ClickClack CLI client (flags: -channel/-server/-token/-workspace/-json/-plain/etc). Fell through to no-version-flag.
> 3. du clickclack.db — 556K.
> 4. serve.log — 815 lines.
> 5. tail -3 — last activity 04:02:06: GET+POST on this channel's /messages endpoint, all 200/201. Server healthy on 127.0.0.1:8101.

## Honesty notes

- **Surface:** clickclack-stock (`:8101`), OpenClaw native `clickclack` channel. Not clickglass.
- **Single variable:** before vs after differ only by the progress producer being off vs on. Same instance, channel, and prompt shape.
- **What the preamble shows here:** the agent emitted tool steps (`agent_tool` rows) for this turn; the producer also classifies non-tool progress (thinking/commentary/lifecycle) as `agent_commentary` rows when the model emits them. This run was tool-heavy, so the visible preamble is tool rows.
- **Rendering is durable, not live-streamed:** in stock ClickClack these rows persist and render on channel load; they are not pushed live to an open tab. The animation above shows the build by refetching as each durable row lands — faithful to the real-time order the work happened in — while the live in-tab WebSocket paint is the next increment on top of this durable surface.
- **Model:** the source channel session was pinned to a healthy primary for the capture; the progress behavior is model-agnostic.
- **Recordings:** zero-dependency CDP screenshot capture pinned to a dedicated tab at 2× desktop resolution, stopped by watching the database for the reply, encoded to GIF and kept small for inline rendering.

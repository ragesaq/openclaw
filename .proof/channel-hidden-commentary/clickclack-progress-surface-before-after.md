# ClickClack progress surface — before / after

Canonical before/after for the channel-hidden-commentary work, recorded on **clickclack-stock** (not clickglass). This is the surface the migration targets: the first-party ClickClack server, driven through OpenClaw's native `clickclack` channel.

## What this proves

Stock ClickClack only renders final messages. While an agent works a turn, the channel is blank — no visibility into the tool steps or commentary happening server-side. The progress producer surfaces that in-flight activity as a live **PREAMBLE** panel in the channel, then the final reply lands as normal.

- **Before:** agent is working, channel shows nothing but the user's message.
- **After:** a live preamble panel builds up the agent's tool steps in real time, then the full reply appears.

## Controlled setup (one variable)

A second, isolated stock install was stood up specifically as the source lab, so captures run uncontended and production (`:8100`) is never touched:

- **Instance:** `clickclack-stock` on `127.0.0.1:8101`, own data dir, byte-identical binary, isolated SQLite.
- **Channel:** native OpenClaw `clickclack` channel, `src` account → `:8101` (additive; the `:8100` default account is untouched).
- **The only variable between the two runs is the progress producer bridge:** off for _before_, on for _after_. Same instance, same channel, same prompt.

Prompt used for both runs:

> Read-only tour of this clickclack-stock install, narrate each step as you go: (1) list the top-level files in the clickclack-stock-src directory, (2) print the binary --version, (3) report the size of data/clickclack.db. Then summarize in 4 bullets what this install is. Read-only only, no writes.

## Before — stock ClickClack, no progress producer

The message is sent and the channel just sits. No preamble, no tool rows, no indication the agent is even working.

![Before: blank channel while the agent works, no progress surface](clickclack-before-blank-no-progress.gif)

## After — progress producer on

The same prompt. A `PREAMBLE` panel appears, marked **LIVE**, and accumulates the agent's tool steps in real time (each `exec` surfaced as a row) before the final 4-bullet reply lands.

![After: live PREAMBLE panel building the agent's tool steps, then the reply](clickclack-after-preamble-building.gif)

Frame-sampled arc of the same run (empty → preamble builds → reply):

![After contact sheet: empty, preamble building with growing tool rows, final reply](clickclack-after-contactsheet.png)

## The actual after transcript

What the channel rendered, in order (durable rows, real turn):

1. **user** — the read-only tour prompt
2. **agent_tool** — `exec` · `cd .../clickclack-stock-src && ls -la`
3. **agent_tool** — `exec` · `./clickclack-stock-bin --version 2>&1 | head -20`
4. **agent_tool** — `exec` · `ls -la data/ && du -h data/clickclack.db && stat -c '%s bytes' ...`
5. **agent_tool** — `exec` · inspect `serve.log` (first/last lines)
6. **message** — final reply:

> Read-only tour done. Results:
>
> 1. Top-level files in clickclack-stock-src: clickclack-stock-bin (27MB executable), data/ (directory), serve.log (~28KB)
> 2. Binary --version: no version flag exists. `./clickclack-stock-bin --version` errors with "flag provided but not defined: -version" and dumps usage. It's a Go CLI with flags like -channel, -server, -token, -json, -plain.
> 3. data/clickclack.db size: 4096 bytes (4.0K). The real data lives in the WAL sidecar (clickclack.db-wal is 2.36MB, not yet checkpointed) plus a 32KB -shm file.
>
> What this install is, in 4 bullets:
>
> - A self-contained ClickClack stock build: one Go binary plus a data/ dir (SQLite db, logs/, uploads/).
> - It's a chat server + CLI. serve.log shows a live HTTP server on localhost:8101 serving /api/channels, /api/messages, /api/realtime/events.
> - SQLite in WAL mode (db file tiny, data in the -wal sidecar), so it's actively running.
> - It's backing this very conversation; no writes made, read-only throughout.

## Honesty notes

- **Surface:** clickclack-stock (`:8101`), OpenClaw native `clickclack` channel. Not clickglass.
- **Single variable:** before vs after differ only by the progress producer being off vs on. Same instance, channel, and prompt.
- **What the preamble shows here:** the agent emitted tool steps (`agent_tool` rows) for this turn; the producer also classifies non-tool progress (thinking/commentary/lifecycle) as `agent_commentary` rows when the model emits them. This run was tool-heavy, so the visible preamble is tool rows.
- **Model:** the source channel session was pinned to a healthy primary for the capture; the progress behavior is model-agnostic.
- **Recordings:** zero-dependency CDP screenshot capture pinned to a dedicated tab, encoded to GIF. GIFs are cropped to the message region and kept small for inline rendering.

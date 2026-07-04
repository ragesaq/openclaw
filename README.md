# ClickClack agent-activity evidence

Before/after capture for the `extensions/clickclack` durable agent-activity PR.

- Merge base: `bd2740fedc` (openclaw/openclaw main); PR head: `59c98669dc`.
- ClickClack server: upstream `main@51a375d`, built from source (`go build ./apps/api/cmd/clickclack`), one instance on `:8101` for both runs.
- Same channel name (#agent-demo, recreated empty between takes), same prompt, same steps: type prompt in composer, wait for the turn, open the reply thread.
- BEFORE gateway: openclaw built at the merge base; ClickClack account without activity opt-in (key does not exist there).
- AFTER gateway: openclaw built at PR head; same account plus `agentActivity: true` and a bot token carrying `agent_activity:write`.
- `clickclack-before-prose-only.gif` — turn runs invisibly; only a thread reply appears at the end.
- `clickclack-after-agent-activity.gif` — durable `agent_commentary` + `agent_tool` rows stream into the channel during the turn; final reply lands in the thread.
- Contact sheets are frame-by-frame verification of each capture.

// Repro: Discord verbose-off shape — classifyCommentaryText engaged, no commentary consumer.
const mod = await import(process.argv[2]);
const createCliJsonlStreamingParser = mod.createCliJsonlStreamingParser || mod.a;
const deltas = [];
const commentary = [];
const parser = createCliJsonlStreamingParser({
  backend: { command: "claude", output: "jsonl", jsonlDialect: "claude-stream-json", sessionIdFields: ["session_id"] },
  providerId: "claude-cli",
  classifyCommentaryText: true, // commentaryProgressEnabled !== undefined (false-positive on Discord verbose off)
  onAssistantDelta: (d) => deltas.push(d.delta),
  // onCommentaryText: undefined  <-- no consumer wired (verbose lane off)
});
const lines = [
  { type: "init", session_id: "s1" },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Let me check the config first." } } },
  { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } } },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " Now I'll grep for the handler." } } },
  { type: "stream_event", event: { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "t2", name: "Grep", input: {} } } },
];
for (const l of lines) parser.push(JSON.stringify(l) + "\n");
parser.finish();
console.log("assistant deltas received:", JSON.stringify(deltas));
console.log(deltas.length === 0 ? "RESULT: narration DROPPED (bug)" : "RESULT: narration preserved (fixed)");

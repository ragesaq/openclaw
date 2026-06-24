// Coverage for the stream-layer repeated-tool-call loop breaker. This guard is
// the escalation of the before_tool_call loop detector: the detector can veto a
// runaway identical tool call but cannot stop the run, so a model that ignores
// the veto and re-emits the call spins until a hard error. The breaker rewrites
// the assistant turn to plain text once the repeat count exceeds the threshold.
import { describe, expect, it } from "vitest";
import type { StreamFn } from "../../runtime/index.js";
import { wrapStreamFnGuardRepeatedToolCallLoop } from "./attempt.tool-call-normalization.js";

type FakeWrappedStream = {
  result: () => Promise<unknown>;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

function makeToolCallMessage(params: {
  name: string;
  args: unknown;
  id?: string;
}): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: params.id ?? `call_${Math.random().toString(36).slice(2)}`,
        name: params.name,
        arguments: params.args,
      },
    ],
    stopReason: "toolUse",
  };
}

function makeTextMessage(text: string): Record<string, unknown> {
  return { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" };
}

function createFakeStream(resultMessage: unknown): FakeWrappedStream {
  return {
    async result() {
      return resultMessage;
    },
    [Symbol.asyncIterator]() {
      return (async function* () {
        yield { type: "message_done", message: resultMessage };
      })();
    },
  };
}

/** Build a StreamFn that returns the supplied messages one per invocation. */
function streamFnFromMessages(messages: unknown[]): StreamFn {
  let index = 0;
  return (() => {
    const message = messages[Math.min(index, messages.length - 1)];
    index += 1;
    return createFakeStream(message);
  }) as unknown as StreamFn;
}

function firstTextContent(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const block = content.find(
    (entry) => entry && typeof entry === "object" && (entry as { type?: unknown }).type === "text",
  ) as { text?: unknown } | undefined;
  return typeof block?.text === "string" ? block.text : undefined;
}

function hasToolCall(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (entry) =>
      entry && typeof entry === "object" && (entry as { type?: unknown }).type === "toolCall",
  );
}

const ARGS = { agentId: "forge", activeMinutes: 60, messageLimit: 1 };

describe("wrapStreamFnGuardRepeatedToolCallLoop", () => {
  it("returns the base stream fn unchanged when threshold is 0 (loop detection disabled)", () => {
    const baseFn = streamFnFromMessages([
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
    ]);
    const wrapped = wrapStreamFnGuardRepeatedToolCallLoop(baseFn, { threshold: 0 });
    expect(wrapped).toBe(baseFn);
  });

  it("rewrites the assistant turn to plain text after identical calls exceed the threshold", async () => {
    const threshold = 5;
    const messages = Array.from({ length: 10 }, () =>
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
    );
    const wrapped = wrapStreamFnGuardRepeatedToolCallLoop(streamFnFromMessages(messages), {
      threshold,
    });

    const results: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      const stream = (await wrapped(
        {} as never,
        {} as never,
        undefined as never,
      )) as FakeWrappedStream;
      results.push(await stream.result());
    }

    // Calls 1..threshold are allowed through unchanged; only after the count
    // exceeds the threshold does the breaker rewrite the turn.
    expect(hasToolCall(results[threshold - 1])).toBe(true);
    const broken = results[threshold]; // count === threshold + 1
    expect(hasToolCall(broken)).toBe(false);
    expect(firstTextContent(broken)).toContain("sessions_list");
    expect(firstTextContent(broken)).toMatch(/stuck|stop retrying/i);
  });

  it("does not rewrite when the same tool is called with different arguments", async () => {
    const threshold = 3;
    const messages = Array.from({ length: 8 }, (_unused, i) =>
      makeToolCallMessage({ name: "exec", args: { command: `echo ${i}` } }),
    );
    const wrapped = wrapStreamFnGuardRepeatedToolCallLoop(streamFnFromMessages(messages), {
      threshold,
    });

    for (let i = 0; i < 8; i += 1) {
      const stream = (await wrapped(
        {} as never,
        {} as never,
        undefined as never,
      )) as FakeWrappedStream;
      const result = await stream.result();
      expect(hasToolCall(result)).toBe(true);
    }
  });

  it("resets the streak when a non-tool-call (text) turn interrupts the repeats", async () => {
    const threshold = 3;
    const messages: unknown[] = [
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
      makeTextMessage("Let me reconsider."),
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
    ];
    const wrapped = wrapStreamFnGuardRepeatedToolCallLoop(streamFnFromMessages(messages), {
      threshold,
    });

    const results: unknown[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      const stream = (await wrapped(
        {} as never,
        {} as never,
        undefined as never,
      )) as FakeWrappedStream;
      results.push(await stream.result());
    }
    // The text turn at index 3 resets the counter, so the two repeats after it
    // never reach the threshold and are left intact.
    expect(
      results.every((message) => firstTextContent(message) !== undefined || hasToolCall(message)),
    ).toBe(true);
    expect(hasToolCall(results[5])).toBe(true);
  });

  it("keeps counting state across separate stream invocations within the run", async () => {
    const threshold = 4;
    const messages = Array.from({ length: 7 }, () =>
      makeToolCallMessage({ name: "sessions_list", args: ARGS }),
    );
    const wrapped = wrapStreamFnGuardRepeatedToolCallLoop(streamFnFromMessages(messages), {
      threshold,
    });

    let brokenAt = -1;
    for (let i = 0; i < 7; i += 1) {
      const stream = (await wrapped(
        {} as never,
        {} as never,
        undefined as never,
      )) as FakeWrappedStream;
      const result = await stream.result();
      if (!hasToolCall(result) && brokenAt === -1) {
        brokenAt = i;
      }
    }
    // First rewrite happens on the invocation after the count exceeds threshold.
    expect(brokenAt).toBe(threshold);
  });
});

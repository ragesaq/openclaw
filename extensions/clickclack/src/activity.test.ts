import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClickClackActivityPublisher,
  deriveClickClackNativeEventNonce,
  type ClickClackItemEventPayload,
} from "./activity.js";
import { ClickClackHttpError } from "./http-client.js";
import type { ClickClackMessage } from "./types.js";

type ActivityClient = Parameters<typeof createClickClackActivityPublisher>[0]["client"];
type ActivityCreate = Parameters<ActivityClient["createActivityMessage"]>[0];

function storedMessage(id: string, params: ActivityCreate): ClickClackMessage {
  return {
    id,
    workspace_id: "wsp_1",
    channel_id: params.channelId,
    direct_conversation_id: params.conversationId,
    author_id: "usr_bot",
    thread_root_id: id,
    body: params.body,
    body_format: "markdown",
    created_at: "2026-07-20T00:00:00Z",
  };
}

function createClientMock() {
  let counter = 0;
  const byNonce = new Map<string, ClickClackMessage>();
  const findMessageByNonce = vi.fn(async ({ nonce }: { workspaceId: string; nonce: string }) =>
    byNonce.get(nonce),
  );
  const createActivityMessage = vi.fn(async (params: ActivityCreate) => {
    const existing = byNonce.get(params.nonce);
    if (existing) {
      return existing;
    }
    counter += 1;
    const message = storedMessage(`msg_${counter}`, params);
    byNonce.set(params.nonce, message);
    return message;
  });
  const updateMessageBody = vi.fn(async (messageId: string, body: string) => {
    const entry = [...byNonce.entries()].find(([, message]) => message.id === messageId);
    if (!entry) {
      throw new Error(`missing message ${messageId}`);
    }
    const [nonce, message] = entry;
    const updated = { ...message, body };
    byNonce.set(nonce, updated);
    return updated;
  });
  return {
    client: { findMessageByNonce, createActivityMessage, updateMessageBody } as ActivityClient,
    byNonce,
    findMessageByNonce,
    createActivityMessage,
    updateMessageBody,
  };
}

function createPublisher(client: ActivityClient, onError?: (error: unknown) => void) {
  return createClickClackActivityPublisher({
    client,
    target: { workspaceId: "wsp_1", channelId: "chn_1" },
    turnId: "msg_test",
    flushMs: 10,
    onError,
  });
}

describe("createClickClackActivityPublisher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the required structural nonce vectors", () => {
    expect(deriveClickClackNativeEventNonce("msg_test", "tool", "tool_test")).toBe(
      "ocv1:0b5f0e0daf8c0ddff63197fc4560dbe9daacebc30c2f67c66e8e580ab8de05cc",
    );
    expect(deriveClickClackNativeEventNonce("msg_test", "final", 0)).toBe(
      "ocv1:7cd4c961126c3b19ca291c3df9c158236e17a6a060b80c108b2889780b7e8183",
    );
  });

  it("projects 18 tools and ordered commentary without protected payload fields", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    const protectedSentinels = [
      "PROGRESS_SENTINEL",
      "SUMMARY_SENTINEL",
      "META_SENTINEL",
      "ARGUMENT_SENTINEL",
      "RESULT_SENTINEL",
    ];

    publisher.onItemEvent({
      itemId: "commentary_before",
      kind: "commentary",
      progressText: "Before tools",
    });
    for (let index = 0; index < 18; index += 1) {
      publisher.onItemEvent({
        itemId: `item_${index}`,
        toolCallId: `tool_${index}`,
        kind: "tool",
        name: `exec_${index}`,
        phase: "start",
        progressText: protectedSentinels[0],
        summary: protectedSentinels[1],
        meta: protectedSentinels[2],
        args: { command: protectedSentinels[3] },
        result: protectedSentinels[4],
      } as ClickClackItemEventPayload);
    }
    await publisher.finalize();

    for (let index = 0; index < 18; index += 1) {
      publisher.onItemEvent({
        itemId: `item_${index}`,
        toolCallId: `tool_${index}`,
        kind: "tool",
        name: `exec_${index}`,
        phase: "end",
        status: "completed",
        progressText: protectedSentinels[0],
        summary: protectedSentinels[1],
        meta: protectedSentinels[2],
        args: { command: protectedSentinels[3] },
        result: protectedSentinels[4],
      } as ClickClackItemEventPayload);
    }
    publisher.onItemEvent({
      itemId: "commentary_after",
      kind: "preamble",
      progressText: "After tools",
    });
    await publisher.finalize();

    expect(mock.byNonce.size).toBe(20);
    const rows = [...mock.byNonce.values()];
    expect(rows[0]?.body).toBe("Before tools");
    expect(rows.at(-1)?.body).toBe("After tools");
    const toolRows = rows.filter((row) => row.body.startsWith("Tool:"));
    expect(toolRows).toHaveLength(18);
    for (let index = 0; index < 18; index += 1) {
      expect(toolRows[index]?.body).toBe(
        [
          `Tool: exec_${index}`,
          "Status: completed",
          "Arguments: unavailable by policy",
          "Result: unavailable by policy",
        ].join("\n"),
      );
    }
    const observable = JSON.stringify({
      creates: mock.createActivityMessage.mock.calls,
      updates: mock.updateMessageBody.mock.calls,
      rows: [...mock.byNonce.entries()],
    });
    for (const sentinel of protectedSentinels) {
      expect(observable).not.toContain(sentinel);
    }
    expect(mock.findMessageByNonce).toHaveBeenCalledTimes(
      mock.createActivityMessage.mock.calls.length + mock.updateMessageBody.mock.calls.length,
    );
  });

  it("coalesces sanitized commentary and caps it at 8 KiB", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    publisher.onItemEvent({
      itemId: "commentary_1",
      kind: "commentary",
      progressText: "First",
    });
    await vi.advanceTimersByTimeAsync(20);
    publisher.onItemEvent({
      itemId: "commentary_1",
      kind: "commentary",
      progressText: `First ${"x".repeat(10_000)}`,
    });
    await publisher.finalize();

    expect(mock.createActivityMessage).toHaveBeenCalledTimes(1);
    expect(mock.updateMessageBody).toHaveBeenCalledTimes(1);
    const stored = [...mock.byNonce.values()][0];
    expect(Buffer.byteLength(stored?.body ?? "", "utf8")).toBe(8 * 1024);
  });

  it("drops private lanes and emits deterministic bounded markers", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    for (const kind of ["analysis", "thinking", "reasoning"]) {
      publisher.onItemEvent({ itemId: `${kind}_1`, kind, progressText: `${kind}_SECRET` });
    }
    publisher.onItemEvent({ itemId: "life_1", kind: "lifecycle", progressText: "LIFE_SECRET" });
    publisher.onItemEvent({ kind: "tool", name: "exec" });
    publisher.onItemEvent({ itemId: "bad\u0000id", kind: "tool", name: "exec" });
    publisher.onItemEvent({ itemId: "plan_1", kind: "plan", summary: "PLAN_SECRET" });
    publisher.onItemEvent({
      itemId: "commentary_ambiguous",
      toolCallId: "tool_conflict",
      kind: "commentary",
      progressText: "AMBIGUOUS_SECRET",
    });
    // Duplicate marker classes converge on their structural nonce.
    publisher.onItemEvent({ kind: "tool", name: "other" });
    publisher.onItemEvent({ itemId: "plan_2", kind: "plan", summary: "OTHER_SECRET" });
    await publisher.finalize();

    expect(mock.byNonce.size).toBe(4);
    expect([...mock.byNonce.values()].map((row) => row.body).toSorted()).toEqual(
      [
        "Activity unavailable: missing stable identity",
        "Activity unavailable: missing stable identity",
        "Activity unavailable: unsupported event kind",
        "Commentary unavailable",
      ].toSorted(),
    );
    expect(JSON.stringify([...mock.byNonce.entries()])).not.toMatch(
      /analysis_SECRET|thinking_SECRET|reasoning_SECRET|LIFE_SECRET|PLAN_SECRET|AMBIGUOUS_SECRET/u,
    );
  });

  it("classifies private and tool events before reading protected payload fields", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    const protectedFields = ["progressText", "summary", "meta", "args", "result"] as const;

    for (const kind of ["analysis", "thinking", "reasoning"]) {
      const payload = { kind } as ClickClackItemEventPayload;
      for (const field of protectedFields) {
        Object.defineProperty(payload, field, {
          get: () => {
            throw new Error(`read protected ${field}`);
          },
        });
      }
      expect(() => publisher.onItemEvent(payload)).not.toThrow();
    }

    const tool = {
      kind: "tool",
      toolCallId: "tool_class_first",
      name: "exec",
      phase: "start",
    } as ClickClackItemEventPayload;
    for (const field of protectedFields) {
      Object.defineProperty(tool, field, {
        get: () => {
          throw new Error(`read protected ${field}`);
        },
      });
    }
    expect(() => publisher.onItemEvent(tool)).not.toThrow();
    await publisher.finalize();

    expect(mock.byNonce.size).toBe(1);
    expect([...mock.byNonce.values()][0]?.body).toContain("Tool: exec");
  });

  it("reserves the 64th row for one overflow marker", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    for (let index = 0; index < 70; index += 1) {
      publisher.onItemEvent({
        itemId: `commentary_${index}`,
        kind: "commentary",
        progressText: `row ${index}`,
      });
    }
    await publisher.finalize();

    expect(mock.byNonce.size).toBe(64);
    expect(
      [...mock.byNonce.values()].filter(
        (row) => row.body === "Additional activity unavailable: turn limit reached",
      ),
    ).toHaveLength(1);
  });

  it("caps total durable activity bodies at 128 KiB including overflow", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    for (let index = 0; index < 30; index += 1) {
      publisher.onItemEvent({
        itemId: `commentary_bytes_${index}`,
        kind: "commentary",
        progressText: "x".repeat(8 * 1024),
      });
    }
    await publisher.finalize();

    const rows = [...mock.byNonce.values()];
    const totalBodyBytes = rows.reduce(
      (total, row) => total + Buffer.byteLength(row.body, "utf8"),
      0,
    );
    expect(totalBodyBytes).toBeLessThanOrEqual(128 * 1024);
    expect(
      rows.filter((row) => row.body === "Additional activity unavailable: turn limit reached"),
    ).toHaveLength(1);
  });

  it("reconciles a lost create acknowledgement by structural nonce", async () => {
    const mock = createClientMock();
    mock.createActivityMessage.mockImplementationOnce(async (params: ActivityCreate) => {
      const persisted = storedMessage("msg_lost_ack", params);
      mock.byNonce.set(params.nonce, persisted);
      throw new Error("connection reset after commit");
    });
    const firstErrors: unknown[] = [];
    const first = createPublisher(mock.client, (error) => firstErrors.push(error));
    first.onItemEvent({
      itemId: "commentary_retry",
      kind: "commentary",
      progressText: "Retry-safe commentary",
    });
    await first.finalize();

    const second = createPublisher(mock.client);
    second.onItemEvent({
      itemId: "commentary_retry",
      kind: "commentary",
      progressText: "Retry-safe commentary",
    });
    await second.finalize();

    expect(firstErrors).toHaveLength(1);
    expect(mock.createActivityMessage).toHaveBeenCalledTimes(1);
    expect(mock.byNonce.size).toBe(1);
    expect(mock.updateMessageBody).not.toHaveBeenCalled();
  });

  it("disables later activity after a 403 without exposing the response detail", async () => {
    const mock = createClientMock();
    mock.createActivityMessage.mockRejectedValueOnce(
      new ClickClackHttpError(403, "SECRET_SERVER_DETAIL", new Headers()),
    );
    const errors: unknown[] = [];
    const publisher = createPublisher(mock.client, (error) => errors.push(error));
    publisher.onItemEvent({ toolCallId: "tool_1", kind: "tool", name: "exec", phase: "start" });
    publisher.onItemEvent({ toolCallId: "tool_2", kind: "tool", name: "read", phase: "start" });
    await publisher.finalize();

    expect(mock.createActivityMessage).toHaveBeenCalledTimes(1);
    expect(String(errors[0])).toContain("status 403");
    expect(String(errors[0])).not.toContain("SECRET_SERVER_DETAIL");
  });

  it("stamps provenance only on newly created safe rows", async () => {
    const mock = createClientMock();
    const publisher = createPublisher(mock.client);
    publisher.setProvenance({ model: "openai/gpt-5.6-sol", thinking: "high" });
    publisher.onItemEvent({
      itemId: "commentary_provenance",
      kind: "preamble",
      progressText: "Working",
    });
    await publisher.finalize();

    expect(mock.createActivityMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: { model: "openai/gpt-5.6-sol", thinking: "high" },
      }),
    );
  });
});

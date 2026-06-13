import { describe, expect, it, vi } from "vitest";
import { createClickClackActivityPublisher } from "./activity.js";
import type { ClickClackClient } from "./http-client.js";

function createClient(): ClickClackClient {
  return {
    createChannelMessage: vi.fn(async (_channelId: string, _input: unknown) => ({
      id: "msg_activity_1",
      workspace_id: "wsp_1",
      channel_id: "chn_1",
      author_id: "bot_1",
      thread_root_id: "msg_activity_1",
      body: "activity",
      body_format: "markdown",
      created_at: "2026-06-13T00:00:00.000Z",
    })),
    createDirectConversation: vi.fn(),
    createDirectMessage: vi.fn(),
    createThreadReply: vi.fn(),
    updateMessage: vi.fn(async (_messageId: string, body: string) => ({
      id: "msg_activity_1",
      workspace_id: "wsp_1",
      channel_id: "chn_1",
      author_id: "bot_1",
      thread_root_id: "msg_activity_1",
      body,
      body_format: "markdown",
      created_at: "2026-06-13T00:00:00.000Z",
    })),
    me: vi.fn(),
    workspaces: vi.fn(),
    channels: vi.fn(),
    channelMessages: vi.fn(),
    directMessages: vi.fn(),
    events: vi.fn(),
    thread: vi.fn(),
    websocket: vi.fn(),
  } as unknown as ClickClackClient;
}

describe("createClickClackActivityPublisher", () => {
  it("creates and updates one durable commentary row per item", async () => {
    const client = createClient();
    const publisher = createClickClackActivityPublisher({
      client,
      target: { channelId: "chn_1" },
      turnId: "msg_user_1",
    });

    await publisher.pushCommentary("checking the files", "pre_1");
    await publisher.pushCommentary("checking the files and tests", "pre_1");
    await publisher.flushAll();

    expect(client.createChannelMessage).toHaveBeenCalledTimes(1);
    expect(client.createChannelMessage).toHaveBeenCalledWith("chn_1", {
      body: "checking the files",
      kind: "agent_commentary",
      turn_id: "msg_user_1",
    });
    expect(client.updateMessage).toHaveBeenCalledTimes(1);
    expect(client.updateMessage).toHaveBeenCalledWith(
      "msg_activity_1",
      "checking the files and tests",
    );
  });

  it("writes tool activity as agent_tool rows", async () => {
    const client = createClient();
    const publisher = createClickClackActivityPublisher({
      client,
      target: { channelId: "chn_1" },
      turnId: "msg_user_1",
    });

    await publisher.pushTool({ name: "exec", phase: "start", toolCallId: "tool_1" });
    await publisher.pushCommandOutput({
      name: "exec",
      phase: "end",
      output: "tests passed",
      status: "ok",
      toolCallId: "tool_1",
    });
    await publisher.flushAll();

    expect(client.createChannelMessage).toHaveBeenCalledTimes(1);
    expect(client.createChannelMessage).toHaveBeenCalledWith("chn_1", {
      body: "exec\n\nPhase: start",
      kind: "agent_tool",
      turn_id: "msg_user_1",
    });
    expect(client.updateMessage).toHaveBeenCalledWith(
      "msg_activity_1",
      "exec\n\nPhase: end\n\nStatus: ok\n\ntests passed",
    );
  });
});

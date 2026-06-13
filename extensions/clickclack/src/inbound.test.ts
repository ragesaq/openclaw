// Clickclack tests cover inbound plugin behavior.
import { createPluginRuntimeMock } from "openclaw/plugin-sdk/channel-test-helpers";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleClickClackInbound } from "./inbound.js";
import { setClickClackRuntime } from "./runtime.js";
import type { ClickClackMessage, CoreConfig, ResolvedClickClackAccount } from "./types.js";

const sendClickClackTextMock = vi.hoisted(() => vi.fn());
const activityPublisherMock = vi.hoisted(() => ({
  pushApproval: vi.fn(async () => undefined),
  pushCommandOutput: vi.fn(async () => undefined),
  pushItem: vi.fn(async () => undefined),
  pushPatchSummary: vi.fn(async () => undefined),
  pushPlanUpdate: vi.fn(async () => undefined),
  pushTool: vi.fn(async () => undefined),
  flushAll: vi.fn(async () => undefined),
}));
const createClickClackActivityPublisherMock = vi.hoisted(() => vi.fn(() => activityPublisherMock));

type LlmCompleteMock = ReturnType<
  typeof vi.fn<
    (params: {
      agentId?: string;
      model?: string;
      maxTokens?: number;
      purpose?: string;
      messages?: unknown[];
    }) => Promise<unknown>
  >
>;

vi.mock("./outbound.js", () => ({
  sendClickClackText: sendClickClackTextMock,
}));

vi.mock("./activity.js", () => ({
  createClickClackActivityPublisher: createClickClackActivityPublisherMock,
}));

function createRuntime(): PluginRuntime {
  return createPluginRuntimeMock({
    agent: {
      runEmbeddedAgent: vi.fn().mockResolvedValue({
        payloads: [{ text: "service bot online" }],
        meta: {},
      }),
    },
    channel: {
      routing: {
        resolveAgentRoute({
          accountId,
          peer,
        }: Parameters<PluginRuntime["channel"]["routing"]["resolveAgentRoute"]>[0]) {
          return {
            agentId: "main",
            channel: "clickclack",
            accountId: accountId ?? "default",
            sessionKey: `agent:main:clickclack:${peer?.kind ?? "channel"}:${peer?.id ?? "general"}`,
            mainSessionKey: "agent:main:main",
            lastRoutePolicy: "session",
            matchedBy: "default",
          };
        },
        buildAgentSessionKey({
          agentId,
          channel,
          accountId,
          peer,
        }: Parameters<PluginRuntime["channel"]["routing"]["buildAgentSessionKey"]>[0]) {
          return `agent:${agentId}:${channel}:${accountId ?? "default"}:${peer?.kind ?? "channel"}:${peer?.id ?? "general"}`;
        },
      },
    },
    llm: {
      complete: vi.fn().mockResolvedValue({
        text: "service bot online",
        provider: "openai",
        model: "gpt-5.4-mini",
        agentId: "service-bot",
        usage: {},
        audit: {
          caller: { kind: "plugin", id: "clickclack" },
        },
      }),
    },
  } as unknown as PluginRuntime);
}

function createAgentAccount(
  overrides: Partial<ResolvedClickClackAccount> = {},
): ResolvedClickClackAccount {
  const base = {
    accountId: "default",
    enabled: true,
    configured: true,
    baseUrl: "http://127.0.0.1:8080",
    token: "ccb_default",
    workspace: "wsp_1",
    replyMode: "agent",
    toolsAllow: [],
    defaultTo: "channel:general",
    allowFrom: ["*"],
    reconnectMs: 1_500,
    config: {
      allowFrom: ["*"],
    },
  } satisfies ResolvedClickClackAccount;

  return {
    ...base,
    ...overrides,
    config: {
      ...base.config,
      ...overrides.config,
    },
  };
}

function createMessage(overrides: Partial<ClickClackMessage> = {}): ClickClackMessage {
  return {
    id: "msg_1",
    workspace_id: "wsp_1",
    channel_id: "chn_1",
    author_id: "usr_owner",
    thread_root_id: "msg_1",
    body: "/fast on",
    body_format: "markdown",
    created_at: "2026-05-09T12:00:00.000Z",
    author: {
      id: "usr_owner",
      kind: "human",
      display_name: "Peter",
      handle: "steipete",
      avatar_url: "",
      created_at: "2026-05-09T12:00:00.000Z",
    },
    ...overrides,
  };
}

describe("handleClickClackInbound", () => {
  beforeEach(() => {
    sendClickClackTextMock.mockReset();
    createClickClackActivityPublisherMock.mockClear();
    activityPublisherMock.pushApproval.mockClear();
    activityPublisherMock.pushCommandOutput.mockClear();
    activityPublisherMock.pushItem.mockClear();
    activityPublisherMock.pushPatchSummary.mockClear();
    activityPublisherMock.pushPlanUpdate.mockClear();
    activityPublisherMock.pushTool.mockClear();
    activityPublisherMock.flushAll.mockClear();
  });

  it("runs model-mode bot accounts without tools and posts the bot reply", async () => {
    const runtime = createRuntime();
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
    } satisfies CoreConfig;
    const account = {
      accountId: "service",
      enabled: true,
      configured: true,
      baseUrl: "http://127.0.0.1:8080",
      token: "ccb_service",
      workspace: "wsp_1",
      agentId: "service-bot",
      replyMode: "model",
      model: "openai/gpt-5.4-mini",
      toolsAllow: [],
      defaultTo: "channel:general",
      allowFrom: ["*"],
      reconnectMs: 1_500,
      config: {},
    } satisfies ResolvedClickClackAccount;

    await handleClickClackInbound({
      account,
      config: cfg,
      message: {
        id: "msg_1",
        workspace_id: "wsp_1",
        channel_id: "chn_1",
        author_id: "usr_human",
        thread_root_id: "msg_1",
        body: "hello bot",
        body_format: "markdown",
        created_at: "2026-05-09T12:00:00.000Z",
        author: {
          id: "usr_human",
          kind: "human",
          display_name: "Peter",
          handle: "steipete",
          avatar_url: "",
          created_at: "2026-05-09T12:00:00.000Z",
        },
      },
    });

    expect(runtime.channel.inbound.dispatchReply).not.toHaveBeenCalled();
    expect(createClickClackActivityPublisherMock).not.toHaveBeenCalled();
    expect(runtime.agent.runEmbeddedAgent).not.toHaveBeenCalled();
    const completionRequest = (runtime.llm.complete as LlmCompleteMock).mock.calls[0]?.[0];
    expect(completionRequest?.agentId).toBe("service-bot");
    expect(completionRequest?.model).toBe("openai/gpt-5.4-mini");
    expect(completionRequest?.maxTokens).toBe(96);
    expect(completionRequest?.purpose).toBe("clickclack bot reply");
    expect(completionRequest?.messages).toEqual([{ role: "user", content: "hello bot" }]);

    const sendRequest = sendClickClackTextMock.mock.calls[0]?.[0];
    expect(sendRequest?.accountId).toBe("service");
    expect(sendRequest?.to).toBe("channel:chn_1");
    expect(sendRequest?.text).toBe("service bot online");
    expect(sendRequest?.replyToId).toBe("msg_1");
  });

  it("marks agent turns command-authorized for allowlisted senders", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.channel.commands.shouldComputeCommandAuthorized).mockReturnValue(true);
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
    } satisfies CoreConfig;

    await handleClickClackInbound({
      account: createAgentAccount({
        allowFrom: ["usr_owner"],
        config: { allowFrom: ["usr_owner"] },
      }),
      config: cfg,
      message: createMessage(),
    });

    const dispatchReply = vi.mocked(runtime.channel.inbound.dispatchReply);
    expect(dispatchReply).toHaveBeenCalledTimes(1);
    expect(dispatchReply.mock.calls[0]?.[0].ctxPayload.CommandAuthorized).toBe(true);
  });

  it("propagates account toolsAllow into agent reply dispatch", async () => {
    const runtime = createRuntime();
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
      tools: {
        allow: ["*"],
      },
    } satisfies CoreConfig;

    await handleClickClackInbound({
      account: createAgentAccount({
        toolsAllow: ["message"],
      }),
      config: cfg,
      message: createMessage(),
    });

    const dispatchReply = vi.mocked(runtime.channel.inbound.dispatchReply);
    expect(dispatchReply).toHaveBeenCalledTimes(1);
    const dispatchParams = dispatchReply.mock.calls[0]?.[0] as
      | (Record<string, unknown> & {
          toolsAllow?: unknown;
        })
      | undefined;
    expect(dispatchParams?.toolsAllow).toEqual(["message"]);
  });

  it("passes agent progress callbacks that publish durable ClickClack activity rows", async () => {
    const runtime = createRuntime();
    const dispatchReply = vi.mocked(runtime.channel.inbound.dispatchReply);
    let replyOptions: Record<string, unknown> | undefined;
    dispatchReply.mockImplementationOnce(async (params) => {
      replyOptions = (params as { replyOptions?: Record<string, unknown> }).replyOptions;
      const options = replyOptions as {
        onToolStart?: (payload: {
          name?: string;
          phase?: string;
          toolCallId?: string;
        }) => Promise<void>;
        onItemEvent?: (payload: {
          kind?: string;
          progressText?: string;
          itemId?: string;
          name?: string;
        }) => Promise<void>;
        onCommandOutput?: (payload: {
          name?: string;
          phase?: string;
          output?: string;
          toolCallId?: string;
        }) => Promise<void>;
        onVerboseProgressVisibility?: (isActive: () => boolean) => void;
      };
      await options.onToolStart?.({ name: "exec", phase: "start", toolCallId: "tool_1" });
      await options.onItemEvent?.({
        kind: "preamble",
        progressText: "checking the channel stream",
        itemId: "pre_1",
      });
      options.onVerboseProgressVisibility?.(() => true);
      await options.onItemEvent?.({
        kind: "preamble",
        progressText: "duplicate verbose progress",
        itemId: "pre_2",
      });
      await options.onItemEvent?.({
        kind: "tool",
        progressText: "exec running",
        itemId: "tool_1",
        name: "exec",
      });
      await options.onCommandOutput?.({
        name: "exec",
        phase: "end",
        output: "done",
        toolCallId: "tool_1",
      });
    });
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
    } satisfies CoreConfig;

    await handleClickClackInbound({
      account: createAgentAccount(),
      config: cfg,
      message: createMessage(),
    });

    expect(createClickClackActivityPublisherMock).toHaveBeenCalledTimes(1);
    expect(createClickClackActivityPublisherMock.mock.calls[0]?.[0]).toMatchObject({
      target: { channelId: "chn_1", directConversationId: undefined },
      turnId: "msg_1",
    });
    expect(replyOptions).toMatchObject({
      runId: "clickclack:msg_1",
      suppressDefaultToolProgressMessages: true,
      allowProgressCallbacksWhenSourceDeliverySuppressed: true,
      commentaryProgressEnabled: true,
    });
    expect(activityPublisherMock.pushTool).toHaveBeenCalledWith({
      name: "exec",
      phase: "start",
      toolCallId: "tool_1",
    });
    expect(activityPublisherMock.pushItem).toHaveBeenCalledTimes(2);
    expect(activityPublisherMock.pushItem).toHaveBeenCalledWith({
      kind: "preamble",
      progressText: "checking the channel stream",
      itemId: "pre_1",
    });
    expect(activityPublisherMock.pushItem).toHaveBeenCalledWith({
      kind: "tool",
      progressText: "exec running",
      itemId: "tool_1",
      name: "exec",
    });
    expect(activityPublisherMock.pushCommandOutput).toHaveBeenCalledWith({
      name: "exec",
      phase: "end",
      output: "done",
      toolCallId: "tool_1",
    });
    expect(activityPublisherMock.flushAll).toHaveBeenCalledTimes(1);
  });

  it("accepts ClickClack DM target syntax in allowFrom", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.channel.commands.shouldComputeCommandAuthorized).mockReturnValue(true);
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
    } satisfies CoreConfig;

    await handleClickClackInbound({
      account: createAgentAccount({
        allowFrom: ["dm:usr_owner"],
        config: { allowFrom: ["dm:usr_owner"] },
      }),
      config: cfg,
      message: createMessage({
        channel_id: undefined,
        direct_conversation_id: "dcn_1",
      }),
    });

    const dispatchReply = vi.mocked(runtime.channel.inbound.dispatchReply);
    expect(dispatchReply).toHaveBeenCalledTimes(1);
    expect(dispatchReply.mock.calls[0]?.[0].ctxPayload.ChatType).toBe("direct");
    expect(dispatchReply.mock.calls[0]?.[0].ctxPayload.CommandAuthorized).toBe(true);
  });

  it("does not dispatch agent turns from senders outside allowFrom", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.channel.commands.shouldComputeCommandAuthorized).mockReturnValue(true);
    setClickClackRuntime(runtime);
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
        },
      },
    } satisfies CoreConfig;

    await handleClickClackInbound({
      account: createAgentAccount({
        allowFrom: ["usr_owner"],
        config: { allowFrom: ["usr_owner"] },
      }),
      config: cfg,
      message: createMessage({
        author_id: "usr_attacker",
        author: {
          id: "usr_attacker",
          kind: "human",
          display_name: "Attacker",
          handle: "attacker",
          avatar_url: "",
          created_at: "2026-05-09T12:00:00.000Z",
        },
      }),
    });

    expect(runtime.channel.inbound.dispatchReply).not.toHaveBeenCalled();
    expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

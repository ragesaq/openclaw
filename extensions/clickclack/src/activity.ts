/**
 * Publishes live agent activity into ClickClack's durable message stream.
 */
import type { GetReplyOptions } from "openclaw/plugin-sdk/reply-runtime";
import type { ClickClackClient } from "./http-client.js";

type ActivityTarget = {
  channelId?: string;
  directConversationId?: string;
};

type ActivityRow = {
  messageId?: string;
  body?: string;
  pending: Promise<void>;
};

type ItemPayload = Parameters<NonNullable<GetReplyOptions["onItemEvent"]>>[0];
type ToolPayload = Parameters<NonNullable<GetReplyOptions["onToolStart"]>>[0];
type CommandOutputPayload = Parameters<NonNullable<GetReplyOptions["onCommandOutput"]>>[0];
type PatchSummaryPayload = Parameters<NonNullable<GetReplyOptions["onPatchSummary"]>>[0];
type PlanUpdatePayload = Parameters<NonNullable<GetReplyOptions["onPlanUpdate"]>>[0];
type ApprovalPayload = Parameters<NonNullable<GetReplyOptions["onApprovalEvent"]>>[0];

function firstText(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const text = value?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function activityKey(prefix: string, ...values: Array<string | undefined | null>) {
  return `${prefix}:${firstText(...values) ?? "default"}`;
}

function formatLabel(label: string, value?: string | null) {
  const text = value?.trim();
  return text ? `${label}: ${text}` : undefined;
}

function formatToolBody(params: {
  title?: string | null;
  name?: string | null;
  phase?: string | null;
  status?: string | null;
  detail?: string | null;
}) {
  const heading = firstText(params.title, params.name, "Tool activity") ?? "Tool activity";
  const parts = [
    heading,
    formatLabel("Phase", params.phase),
    formatLabel("Status", params.status),
    firstText(params.detail),
  ].filter((part): part is string => Boolean(part));
  return parts.join("\n\n");
}

function formatPlanBody(payload: PlanUpdatePayload) {
  const steps = payload.steps
    ?.filter((step) => step.trim())
    .map((step) => `- ${step}`)
    .join("\n");
  return [firstText(payload.title, "Plan update"), firstText(payload.explanation), steps]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function formatPatchBody(payload: PatchSummaryPayload) {
  const changed = [
    payload.added?.length ? `Added: ${payload.added.join(", ")}` : undefined,
    payload.modified?.length ? `Modified: ${payload.modified.join(", ")}` : undefined,
    payload.deleted?.length ? `Deleted: ${payload.deleted.join(", ")}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return formatToolBody({
    title: firstText(payload.title, "Patch summary"),
    name: payload.name,
    phase: payload.phase,
    detail: [firstText(payload.summary), ...changed].filter(Boolean).join("\n"),
  });
}

function formatCommandBody(payload: CommandOutputPayload) {
  const status =
    payload.status ??
    (payload.exitCode == null
      ? undefined
      : payload.exitCode === 0
        ? "ok"
        : `exit ${payload.exitCode}`);
  return formatToolBody({
    title: payload.title,
    name: payload.name ?? "command",
    phase: payload.phase,
    status,
    detail: payload.output,
  });
}

function formatApprovalBody(payload: ApprovalPayload) {
  return formatToolBody({
    title: firstText(payload.title, payload.kind, "Approval"),
    name: payload.command,
    phase: payload.phase,
    status: payload.status,
    detail: firstText(payload.message, payload.reason),
  });
}

export function createClickClackActivityPublisher(params: {
  client: ClickClackClient;
  target: ActivityTarget;
  turnId: string;
  onError?: (error: unknown) => void;
}) {
  const rows = new Map<string, ActivityRow>();
  const commentaryBodies = new Map<string, string>();
  const commentaryKeyBodies = new Map<string, string>();

  function commentaryBodyKey(body: string): string {
    return body.replace(/\s+/g, " ").trim();
  }

  async function write(kind: "agent_commentary" | "agent_tool", key: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed || (!params.target.channelId && !params.target.directConversationId)) {
      return;
    }
    const row = rows.get(key) ?? { pending: Promise.resolve() };
    rows.set(key, row);
    if (row.body === trimmed) {
      return row.pending;
    }
    row.body = trimmed;
    row.pending = row.pending
      .catch(() => undefined)
      .then(async () => {
        if (row.messageId) {
          await params.client.updateMessage(row.messageId, trimmed);
          return;
        }
        const input = { body: trimmed, kind, turn_id: params.turnId };
        const message = params.target.channelId
          ? await params.client.createChannelMessage(params.target.channelId, input)
          : await params.client.createDirectMessage(
              params.target.directConversationId ?? "",
              input,
            );
        row.messageId = message.id;
      })
      .catch((error: unknown) => {
        row.body = undefined;
        params.onError?.(error);
      });
    return row.pending;
  }

  const pushCommentary = async (text: string | undefined | null, itemId?: string | null) => {
    const baseKey = activityKey("commentary", itemId);
    const trimmed = text?.trim() ?? "";
    if (!trimmed) {
      await write("agent_commentary", baseKey, "");
      return;
    }

    // Codex app-server surfaces the same commentary as both event_msg and
    // response_item. Those carry different item ids, so dedupe by body too.
    const bodyKey = commentaryBodyKey(trimmed);
    const key = commentaryBodies.get(bodyKey) ?? baseKey;
    const previousBodyKey = commentaryKeyBodies.get(key);
    if (previousBodyKey && previousBodyKey !== bodyKey) {
      commentaryBodies.delete(previousBodyKey);
    }
    commentaryBodies.set(bodyKey, key);
    commentaryKeyBodies.set(key, bodyKey);

    await write("agent_commentary", key, trimmed);
  };

  const pushItem = async (payload: ItemPayload) => {
    if (payload.kind === "preamble") {
      await pushCommentary(payload.progressText, payload.itemId);
      return;
    }
    const key = activityKey("tool", payload.itemId, payload.name, payload.title);
    await write(
      "agent_tool",
      key,
      formatToolBody({
        title: payload.title,
        name: payload.name ?? payload.kind,
        phase: payload.phase,
        status: payload.status,
        detail: firstText(payload.summary, payload.progressText, payload.meta),
      }),
    );
  };

  return {
    pushCommentary,
    pushItem,
    async pushTool(payload: ToolPayload) {
      const key = activityKey("tool", payload.toolCallId, payload.itemId, payload.name);
      const args =
        payload.args && Object.keys(payload.args).length ? JSON.stringify(payload.args) : undefined;
      await write(
        "agent_tool",
        key,
        formatToolBody({
          name: payload.name,
          phase: payload.phase,
          detail: args,
        }),
      );
    },
    async pushCommandOutput(payload: CommandOutputPayload) {
      const key = activityKey(
        "tool",
        payload.toolCallId,
        payload.itemId,
        payload.name,
        payload.title,
      );
      await write("agent_tool", key, formatCommandBody(payload));
    },
    async pushPatchSummary(payload: PatchSummaryPayload) {
      const key = activityKey(
        "tool",
        payload.toolCallId,
        payload.itemId,
        payload.name,
        payload.title,
      );
      await write("agent_tool", key, formatPatchBody(payload));
    },
    async pushPlanUpdate(payload: PlanUpdatePayload) {
      await write(
        "agent_commentary",
        activityKey("plan", payload.source, payload.title),
        formatPlanBody(payload),
      );
    },
    async pushApproval(payload: ApprovalPayload) {
      const key = activityKey(
        "approval",
        payload.approvalId,
        payload.approvalSlug,
        payload.toolCallId,
        payload.itemId,
      );
      await write("agent_tool", key, formatApprovalBody(payload));
    },
    async flushAll() {
      await Promise.all([...rows.values()].map((row) => row.pending));
    },
  };
}

export type ClickClackActivityPublisher = ReturnType<typeof createClickClackActivityPublisher>;

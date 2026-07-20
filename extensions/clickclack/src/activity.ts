/**
 * Publishes a bounded, sanitized projection of native agent events as durable
 * ClickClack activity rows. Classification and structural identity validation
 * happen before any class-specific field is read.
 */
import { createHash } from "node:crypto";
import { sanitizeAssistantVisibleText } from "openclaw/plugin-sdk/text-chunking";
import { ClickClackHttpError } from "./http-client.js";
import type { ClickClackMessage, ClickClackMessageProvenance } from "./types.js";

const CLICKCLACK_COMMENTARY_FLUSH_MS = 700;
const CLICKCLACK_COMMENTARY_MAX_BYTES = 8 * 1024;
const CLICKCLACK_ACTIVITY_MAX_ROWS = 64;
const CLICKCLACK_ACTIVITY_MAX_BODY_BYTES = 128 * 1024;
const OVERFLOW_BODY = "Additional activity unavailable: turn limit reached";
const OVERFLOW_BODY_BYTES = Buffer.byteLength(OVERFLOW_BODY, "utf8");
const CLICKCLACK_CONTENT_MAX_ROWS = CLICKCLACK_ACTIVITY_MAX_ROWS - 1;
const CLICKCLACK_CONTENT_MAX_BODY_BYTES = CLICKCLACK_ACTIVITY_MAX_BODY_BYTES - OVERFLOW_BODY_BYTES;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/u;
const CLICKCLACK_MESSAGE_ID_PATTERN = /^msg_[0-9a-hjkmnp-tv-z]{26}$/u;

const TOOL_ITEM_KINDS = new Set(["tool", "command", "command_output", "patch", "search", "api"]);
const COMMENTARY_ITEM_KINDS = new Set(["preamble", "commentary"]);
const PRIVATE_ITEM_KINDS = new Set(["analysis", "thinking", "reasoning"]);
const SAFE_UNSUPPORTED_ITEM_KINDS = new Set(["plan"]);

export type ClickClackItemEventPayload = {
  itemId?: string;
  toolCallId?: string;
  kind?: string;
  title?: string;
  name?: string;
  phase?: string;
  status?: string;
  summary?: string;
  progressText?: string;
  meta?: string;
};

type ClickClackActivityTarget = {
  workspaceId: string;
  channelId?: string;
  conversationId?: string;
};

type ClickClackActivityClient = {
  findMessageByNonce(params: {
    workspaceId: string;
    nonce: string;
  }): Promise<ClickClackMessage | undefined>;
  createActivityMessage(params: {
    channelId?: string;
    conversationId?: string;
    body: string;
    kind: "agent_commentary" | "agent_tool";
    turnId?: string;
    nonce: string;
    provenance?: ClickClackMessageProvenance;
  }): Promise<ClickClackMessage>;
  updateMessageBody(messageId: string, body: string): Promise<ClickClackMessage>;
};

type NativeEventRowClass = "commentary" | "tool" | "marker" | "overflow" | "final";

export function deriveClickClackNativeEventNonce(
  turnId: string,
  rowClass: NativeEventRowClass,
  stableIdentity: string | number,
): string {
  const preimage = JSON.stringify(["clickclack.native-event/v1", turnId, rowClass, stableIdentity]);
  return `ocv1:${createHash("sha256").update(preimage, "utf8").digest("hex")}`;
}

function normalizedItemKind(payload: ClickClackItemEventPayload): string {
  return typeof payload.kind === "string" ? payload.kind.trim().toLowerCase() : "";
}

function hasIdentityControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isValidStructuralIdentity(value: string | undefined): value is string {
  return Boolean(
    value &&
    Array.from(value).length <= 256 &&
    !hasIdentityControlCharacter(value) &&
    Buffer.from(value, "utf8").toString("utf8") === value,
  );
}

export function isValidClickClackNativeEventTurnId(value: string): boolean {
  return CLICKCLACK_MESSAGE_ID_PATTERN.test(value) && isValidStructuralIdentity(value);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maxBytes) {
      break;
    }
    result += character;
    bytes += nextBytes;
  }
  return result;
}

type ResolvedItemClass =
  | { type: "drop" }
  | { type: "commentary"; kind: "preamble" | "commentary" }
  | { type: "tool"; kind: string }
  | { type: "ambiguous"; kind: string; commentary: boolean }
  | { type: "unsupported"; kind: string };

function resolveItemClass(payload: ClickClackItemEventPayload): ResolvedItemClass {
  const kind = normalizedItemKind(payload);
  if (PRIVATE_ITEM_KINDS.has(kind) || kind === "lifecycle") {
    return { type: "drop" };
  }
  if (COMMENTARY_ITEM_KINDS.has(kind)) {
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
    const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
    if (toolCallId || /^(tool|command):/u.test(itemId)) {
      return { type: "ambiguous", kind, commentary: true };
    }
    return { type: "commentary", kind: kind as "preamble" | "commentary" };
  }
  if (TOOL_ITEM_KINDS.has(kind)) {
    const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
    if (/^(preamble|commentary):/u.test(itemId)) {
      return { type: "ambiguous", kind, commentary: false };
    }
    return { type: "tool", kind };
  }
  return {
    type: "unsupported",
    kind: SAFE_UNSUPPORTED_ITEM_KINDS.has(kind) ? kind : "unknown",
  };
}

type ActivityRow = {
  nonce: string;
  kind: "agent_commentary" | "agent_tool";
  body: string;
  bodyBytes: number;
  messageId?: string;
};

type CommentaryRow = ActivityRow & {
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export type ClickClackActivityPublisher = {
  onItemEvent: (payload: ClickClackItemEventPayload) => void;
  setProvenance: (provenance: ClickClackMessageProvenance) => void;
  finalize: () => Promise<void>;
};

export function createClickClackActivityPublisher(params: {
  client: ClickClackActivityClient;
  target: ClickClackActivityTarget;
  turnId: string;
  flushMs?: number;
  onError?: (error: unknown) => void;
}): ClickClackActivityPublisher {
  const flushMs = params.flushMs ?? CLICKCLACK_COMMENTARY_FLUSH_MS;
  const commentaryRows = new Map<string, CommentaryRow>();
  const toolRows = new Map<string, ActivityRow>();
  const markerIdentities = new Set<string>();
  let provenance: ClickClackMessageProvenance | undefined;
  let contentRowCount = 0;
  let contentBodyBytes = 0;
  let overflowQueued = false;
  let publicationDisabled = false;
  let chain: Promise<void> = Promise.resolve();

  const reportError = (error: unknown): void => {
    const status = error instanceof ClickClackHttpError ? error.status : undefined;
    if (status === 400 || status === 403) {
      publicationDisabled = true;
    }
    params.onError?.(
      new Error(
        status === undefined
          ? "ClickClack activity request failed"
          : `ClickClack activity request failed with status ${status}`,
      ),
    );
  };

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    chain = chain
      .then(async () => {
        if (!publicationDisabled) {
          await work();
        }
      })
      .catch((error: unknown) => {
        reportError(error);
      });
    return chain;
  };

  const persistRow = async (row: ActivityRow): Promise<void> => {
    const existing = await params.client.findMessageByNonce({
      workspaceId: params.target.workspaceId,
      nonce: row.nonce,
    });
    if (existing) {
      row.messageId = existing.id;
      if (existing.body !== row.body) {
        await params.client.updateMessageBody(existing.id, row.body);
      }
      return;
    }
    const posted = await params.client.createActivityMessage({
      channelId: params.target.channelId,
      conversationId: params.target.conversationId,
      body: row.body,
      kind: row.kind,
      turnId: params.turnId,
      nonce: row.nonce,
      provenance,
    });
    row.messageId = posted.id;
  };

  const queueOverflow = (): void => {
    if (overflowQueued) {
      return;
    }
    overflowQueued = true;
    const row: ActivityRow = {
      nonce: deriveClickClackNativeEventNonce(params.turnId, "overflow", "turn_limit"),
      kind: "agent_commentary",
      body: OVERFLOW_BODY,
      bodyBytes: OVERFLOW_BODY_BYTES,
    };
    void enqueue(async () => persistRow(row));
  };

  const reserveNewRow = (bodyBytes: number): boolean => {
    if (
      contentRowCount >= CLICKCLACK_CONTENT_MAX_ROWS ||
      contentBodyBytes + bodyBytes > CLICKCLACK_CONTENT_MAX_BODY_BYTES
    ) {
      queueOverflow();
      return false;
    }
    contentRowCount += 1;
    contentBodyBytes += bodyBytes;
    return true;
  };

  const reserveRowUpdate = (row: ActivityRow, bodyBytes: number): boolean => {
    const nextTotal = contentBodyBytes - row.bodyBytes + bodyBytes;
    if (nextTotal > CLICKCLACK_CONTENT_MAX_BODY_BYTES) {
      queueOverflow();
      return false;
    }
    contentBodyBytes = nextTotal;
    row.bodyBytes = bodyBytes;
    return true;
  };

  const emitMarker = (
    stableIdentity: string,
    body: string,
    rowClass: "marker" | "overflow" = "marker",
  ): void => {
    if (markerIdentities.has(stableIdentity)) {
      return;
    }
    markerIdentities.add(stableIdentity);
    const bodyBytes = Buffer.byteLength(body, "utf8");
    if (!reserveNewRow(bodyBytes)) {
      return;
    }
    const row: ActivityRow = {
      nonce: deriveClickClackNativeEventNonce(params.turnId, rowClass, stableIdentity),
      kind: "agent_commentary",
      body,
      bodyBytes,
    };
    void enqueue(async () => persistRow(row));
  };

  const resolveCommentaryIdentity = (
    payload: ClickClackItemEventPayload,
    kind: string,
  ): string | undefined => {
    const itemId = typeof payload.itemId === "string" ? payload.itemId : undefined;
    if (isValidStructuralIdentity(itemId)) {
      return itemId;
    }
    const reason = itemId ? "invalid_identity" : "missing_identity";
    emitMarker(`${reason}:${kind}`, "Activity unavailable: missing stable identity");
    return undefined;
  };

  const resolveToolIdentity = (
    payload: ClickClackItemEventPayload,
    kind: string,
  ): string | undefined => {
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    const itemId = typeof payload.itemId === "string" ? payload.itemId : undefined;
    if (isValidStructuralIdentity(toolCallId)) {
      return toolCallId;
    }
    if (isValidStructuralIdentity(itemId)) {
      return itemId;
    }
    const reason = toolCallId || itemId ? "invalid_identity" : "missing_identity";
    emitMarker(`${reason}:${kind}`, "Activity unavailable: missing stable identity");
    return undefined;
  };

  const flushCommentary = (identity: string): Promise<void> => {
    const row = commentaryRows.get(identity);
    if (!row) {
      return Promise.resolve();
    }
    if (row.timer) {
      clearTimeout(row.timer);
      row.timer = undefined;
    }
    if (!row.dirty) {
      return Promise.resolve();
    }
    row.dirty = false;
    return enqueue(async () => persistRow(row));
  };

  const flushAllCommentary = (): Promise<void> =>
    Promise.all([...commentaryRows.keys()].map((identity) => flushCommentary(identity))).then(
      () => undefined,
    );

  const handleCommentary = (
    payload: ClickClackItemEventPayload,
    itemClass: Extract<ResolvedItemClass, { type: "commentary" }>,
  ): void => {
    const identity = resolveCommentaryIdentity(payload, itemClass.kind);
    if (!identity) {
      return;
    }
    const rawProgressText = typeof payload.progressText === "string" ? payload.progressText : "";
    const sanitized = sanitizeAssistantVisibleText(rawProgressText);
    const body = sanitized
      ? truncateUtf8(sanitized, CLICKCLACK_COMMENTARY_MAX_BYTES)
      : "Commentary unavailable";
    const bodyBytes = Buffer.byteLength(body, "utf8");
    const existing = commentaryRows.get(identity);
    if (existing) {
      if (bodyBytes < existing.bodyBytes || body === existing.body) {
        return;
      }
      if (!reserveRowUpdate(existing, bodyBytes)) {
        return;
      }
      existing.body = body;
      existing.dirty = true;
      if (!existing.timer) {
        existing.timer = setTimeout(() => {
          existing.timer = undefined;
          void flushCommentary(identity);
        }, flushMs);
      }
      return;
    }
    if (!reserveNewRow(bodyBytes)) {
      return;
    }
    const row: CommentaryRow = {
      nonce: deriveClickClackNativeEventNonce(params.turnId, "commentary", identity),
      kind: "agent_commentary",
      body,
      bodyBytes,
      dirty: true,
    };
    commentaryRows.set(identity, row);
    row.timer = setTimeout(() => {
      row.timer = undefined;
      void flushCommentary(identity);
    }, flushMs);
  };

  const normalizeToolStatus = (payload: ClickClackItemEventPayload): string => {
    const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
    const phase = typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
    if (status === "failed" || status === "error") {
      return "failed";
    }
    if (status === "cancelled" || status === "canceled") {
      return "cancelled";
    }
    if (
      status === "completed" ||
      status === "succeeded" ||
      status === "success" ||
      phase === "end" ||
      phase === "result" ||
      phase === "completed"
    ) {
      return "completed";
    }
    return "started";
  };

  const handleTool = (
    payload: ClickClackItemEventPayload,
    itemClass: Extract<ResolvedItemClass, { type: "tool" }>,
  ): void => {
    const identity = resolveToolIdentity(payload, itemClass.kind);
    if (!identity) {
      return;
    }
    const candidateName = typeof payload.name === "string" ? payload.name.trim() : "";
    const displayName = TOOL_NAME_PATTERN.test(candidateName) ? candidateName : "tool";
    const status = normalizeToolStatus(payload);
    const body = [
      `Tool: ${displayName}`,
      `Status: ${status}`,
      "Arguments: unavailable by policy",
      `Result: ${status === "started" ? "pending" : "unavailable by policy"}`,
    ].join("\n");
    const bodyBytes = Buffer.byteLength(body, "utf8");

    void flushAllCommentary();
    const existing = toolRows.get(identity);
    if (existing) {
      if (existing.body === body || !reserveRowUpdate(existing, bodyBytes)) {
        return;
      }
      existing.body = body;
      void enqueue(async () => persistRow(existing));
      return;
    }
    if (!reserveNewRow(bodyBytes)) {
      return;
    }
    const row: ActivityRow = {
      nonce: deriveClickClackNativeEventNonce(params.turnId, "tool", identity),
      kind: "agent_tool",
      body,
      bodyBytes,
    };
    toolRows.set(identity, row);
    void enqueue(async () => persistRow(row));
  };

  return {
    onItemEvent: (payload) => {
      if (publicationDisabled) {
        return;
      }
      const itemClass = resolveItemClass(payload);
      switch (itemClass.type) {
        case "drop":
          return;
        case "commentary":
          handleCommentary(payload, itemClass);
          return;
        case "tool":
          handleTool(payload, itemClass);
          return;
        case "ambiguous":
          emitMarker(
            `ambiguous_class:${itemClass.kind}`,
            itemClass.commentary
              ? "Commentary unavailable"
              : "Activity unavailable: unsupported event kind",
          );
          return;
        case "unsupported":
          emitMarker(
            `unsupported_kind:${itemClass.kind}`,
            "Activity unavailable: unsupported event kind",
          );
      }
    },
    setProvenance: (next) => {
      provenance = next;
    },
    finalize: async () => {
      await flushAllCommentary();
      await chain;
    },
  };
}

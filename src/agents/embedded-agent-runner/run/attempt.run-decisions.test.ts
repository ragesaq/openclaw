// Coverage for small run-attempt decision helpers.
import { describe, expect, it } from "vitest";
import {
  REPEATED_TOOL_CALL_LOOP_BREAK_MARGIN,
  resolveAttemptStreamAuthProfileId,
  resolveAttemptToolPolicyMessageProvider,
  resolveEmbeddedAttemptSessionWriteLockOptions,
  resolveRepeatedToolCallLoopBreakThreshold,
  resolveUnknownToolGuardThreshold,
  shouldRunLlmOutputHooksForAttempt,
} from "./attempt.run-decisions.js";

describe("resolveEmbeddedAttemptSessionWriteLockOptions", () => {
  it("bounds post-prompt session lock max hold to compaction timeout instead of run timeout", () => {
    // Cleanup writes should not inherit the full model run timeout; the
    // compaction window is the larger session-write risk.
    const options = resolveEmbeddedAttemptSessionWriteLockOptions({
      config: {},
      compactionTimeoutMs: 600_000,
      env: {},
    });

    expect(options.maxHoldMs).toBe(720_000);
  });
});

describe("resolveRepeatedToolCallLoopBreakThreshold", () => {
  it("is disabled (0) when loop detection is disabled", () => {
    expect(resolveRepeatedToolCallLoopBreakThreshold(undefined)).toBe(0);
    expect(resolveRepeatedToolCallLoopBreakThreshold({ enabled: false })).toBe(0);
    expect(
      resolveRepeatedToolCallLoopBreakThreshold({ enabled: false, criticalThreshold: 20 }),
    ).toBe(0);
  });

  it("sits a fixed margin above the critical block point when enabled", () => {
    // Defaults to CRITICAL_THRESHOLD (20) + margin when no critical override.
    expect(resolveRepeatedToolCallLoopBreakThreshold({ enabled: true })).toBe(
      20 + REPEATED_TOOL_CALL_LOOP_BREAK_MARGIN,
    );
    // Honors a configured critical threshold so the breaker stays downstream of
    // the veto regardless of tuning.
    expect(resolveRepeatedToolCallLoopBreakThreshold({ enabled: true, criticalThreshold: 8 })).toBe(
      8 + REPEATED_TOOL_CALL_LOOP_BREAK_MARGIN,
    );
  });

  it("falls back to the default critical threshold for invalid critical values", () => {
    expect(resolveRepeatedToolCallLoopBreakThreshold({ enabled: true, criticalThreshold: 0 })).toBe(
      20 + REPEATED_TOOL_CALL_LOOP_BREAK_MARGIN,
    );
    expect(
      resolveRepeatedToolCallLoopBreakThreshold({ enabled: true, criticalThreshold: -3 }),
    ).toBe(20 + REPEATED_TOOL_CALL_LOOP_BREAK_MARGIN);
  });
});

describe("resolveAttemptStreamAuthProfileId", () => {
  it("uses only the runtime-forwarded auth profile for stream provenance", () => {
    // Raw attempt authProfileId may be a session selection detail; stream
    // provenance should only expose the runtime-forwarded profile.
    expect(
      resolveAttemptStreamAuthProfileId({
        authProfileId: "openai:raw-session-profile",
        runtimePlan: {
          auth: {
            forwardedAuthProfileId: "openai:forwarded-profile",
          },
        } as never,
      }),
    ).toBe("openai:forwarded-profile");

    expect(
      resolveAttemptStreamAuthProfileId({
        authProfileId: "openai:non-forwarded-profile",
        runtimePlan: {
          auth: {},
        } as never,
      }),
    ).toBeUndefined();
  });
});

describe("resolveAttemptToolPolicyMessageProvider", () => {
  it("prefers explicit tool-policy provider over transport channel", () => {
    expect(
      resolveAttemptToolPolicyMessageProvider({
        messageChannel: "discord",
        messageProvider: "discord-voice",
      }),
    ).toBe("discord-voice");
  });

  it("falls back to message channel when provider is omitted", () => {
    expect(resolveAttemptToolPolicyMessageProvider({ messageChannel: "discord" })).toBe("discord");
  });
});

describe("shouldRunLlmOutputHooksForAttempt", () => {
  it("skips llm_output after before_agent_run blocks before model submission", () => {
    expect(shouldRunLlmOutputHooksForAttempt({ promptErrorSource: "hook:before_agent_run" })).toBe(
      false,
    );
    expect(shouldRunLlmOutputHooksForAttempt({ promptErrorSource: "prompt" })).toBe(true);
    expect(shouldRunLlmOutputHooksForAttempt({ promptErrorSource: null })).toBe(true);
  });
});

describe("resolveUnknownToolGuardThreshold", () => {
  it("returns the default threshold when no loop-detection config is provided", () => {
    expect(resolveUnknownToolGuardThreshold(undefined)).toBe(10);
    expect(resolveUnknownToolGuardThreshold({})).toBe(10);
  });

  it("stays on even when tools.loopDetection.enabled is false", () => {
    // Unknown-tool guard is a model-safety circuit, separate from configurable
    // repeated-tool loop detection.
    expect(resolveUnknownToolGuardThreshold({ enabled: false })).toBe(10);
    expect(resolveUnknownToolGuardThreshold({ enabled: false, unknownToolThreshold: 3 })).toBe(3);
  });

  it("uses positive integer thresholds and floors fractions", () => {
    expect(resolveUnknownToolGuardThreshold({ enabled: true, unknownToolThreshold: 4 })).toBe(4);
    expect(resolveUnknownToolGuardThreshold({ unknownToolThreshold: 3.7 })).toBe(3);
  });

  it("falls back to the default threshold when the override is non-positive", () => {
    expect(resolveUnknownToolGuardThreshold({ unknownToolThreshold: 0 })).toBe(10);
    expect(resolveUnknownToolGuardThreshold({ unknownToolThreshold: -5 })).toBe(10);
    expect(resolveUnknownToolGuardThreshold({ unknownToolThreshold: Number.NaN })).toBe(10);
  });
});

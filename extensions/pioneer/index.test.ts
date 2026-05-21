import { registerSingleProviderPlugin } from "openclaw/plugin-sdk/plugin-test-runtime";
import { describe, expect, it } from "vitest";
import { runSingleProviderCatalog } from "../test-support/provider-model-test-helpers.js";
import pioneerPlugin from "./index.js";

describe("pioneer provider plugin", () => {
  it("registers Pioneer with API-key auth", async () => {
    const provider = await registerSingleProviderPlugin(pioneerPlugin);

    expect(provider.id).toBe("pioneer");
    expect(provider.label).toBe("Pioneer");
    expect(provider.envVars).toEqual(["PIONEER_API_KEY"]);
    expect(provider.auth?.map((method) => method.id)).toEqual(["api-key"]);
  });

  it("builds the Pioneer OpenAI-compatible model catalog", async () => {
    const provider = await registerSingleProviderPlugin(pioneerPlugin);
    const catalogProvider = await runSingleProviderCatalog(provider, {
      resolveProviderApiKey: (id?: string) =>
        id === "pioneer" ? { apiKey: "pioneer-test-key" } : { apiKey: undefined },
    });

    expect(catalogProvider.api).toBe("openai-completions");
    expect(catalogProvider.baseUrl).toBe("https://api.pioneer.ai/v1");
    expect(catalogProvider.models?.map((model) => model.id)).toContain("claude-opus-4-7");
    const opus = catalogProvider.models?.find((model) => model.id === "claude-opus-4-7");
    expect(opus?.compat).toMatchObject({
      supportsStore: true,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    });
  });
});

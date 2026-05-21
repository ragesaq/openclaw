import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "openclaw/plugin-sdk/provider-model-shared";
import { applyPioneerConfig, PIONEER_DEFAULT_MODEL_REF } from "./onboard.js";
import { buildPioneerProvider } from "./provider-catalog.js";

const PROVIDER_ID = "pioneer";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Pioneer Provider",
  description: "Bundled Pioneer provider plugin",
  provider: {
    label: "Pioneer",
    docsPath: "/providers/pioneer",
    auth: [
      {
        methodId: "api-key",
        label: "Pioneer API key",
        hint: "OpenAI-compatible inference",
        optionKey: "pioneerApiKey",
        flagName: "--pioneer-api-key",
        envVar: "PIONEER_API_KEY",
        promptMessage: "Enter Pioneer API key",
        defaultModel: PIONEER_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyPioneerConfig(cfg),
        wizard: {
          groupLabel: "Pioneer",
          groupHint: "OpenAI-compatible inference",
        },
      },
    ],
    catalog: {
      buildProvider: buildPioneerProvider,
      buildStaticProvider: buildPioneerProvider,
    },
    ...buildProviderReplayFamilyHooks({
      family: "openai-compatible",
      sanitizeToolCallIds: true,
      dropReasoningFromHistory: true,
    }),
  },
});

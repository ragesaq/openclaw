import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { buildPioneerCatalogModels, PIONEER_BASE_URL } from "./models.js";

export function buildPioneerProvider(): ModelProviderConfig {
  return {
    baseUrl: PIONEER_BASE_URL,
    api: "openai-completions",
    models: buildPioneerCatalogModels(),
  };
}

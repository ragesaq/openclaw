import {
  createModelCatalogPresetAppliers,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { buildPioneerCatalogModels, PIONEER_BASE_URL } from "./models.js";

export const PIONEER_DEFAULT_MODEL_REF = "pioneer/claude-opus-4-7";

const pioneerPresetAppliers = createModelCatalogPresetAppliers({
  primaryModelRef: PIONEER_DEFAULT_MODEL_REF,
  resolveParams: (_cfg: OpenClawConfig) => ({
    providerId: "pioneer",
    api: "openai-completions",
    baseUrl: PIONEER_BASE_URL,
    catalogModels: buildPioneerCatalogModels(),
    aliases: [{ modelRef: PIONEER_DEFAULT_MODEL_REF, alias: "Pioneer Opus 4.7" }],
  }),
});

export function applyPioneerConfig(cfg: OpenClawConfig): OpenClawConfig {
  return pioneerPresetAppliers.applyConfig(cfg);
}

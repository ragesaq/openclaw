import { buildManifestModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-shared";
import manifest from "./openclaw.plugin.json" with { type: "json" };

const PIONEER_MANIFEST_CATALOG = manifest.modelCatalog.providers.pioneer;

export const PIONEER_BASE_URL = PIONEER_MANIFEST_CATALOG.baseUrl;
export const PIONEER_MODEL_CATALOG = PIONEER_MANIFEST_CATALOG.models;

export function buildPioneerCatalogModels() {
  return buildManifestModelProviderConfig({
    providerId: "pioneer",
    catalog: PIONEER_MANIFEST_CATALOG,
  }).models;
}

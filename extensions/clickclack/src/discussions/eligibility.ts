import { normalizeAgentId } from "openclaw/plugin-sdk/routing";
import type { SessionDiscussionInfo } from "openclaw/plugin-sdk/session-discussion";
import {
  listClickClackAccountIds,
  listEnabledClickClackAccounts,
  resolveClickClackAccountConfig,
} from "../accounts.js";
import type { CoreConfig, ResolvedClickClackAccount } from "../types.js";
import type { ClickClackDiscussionBinding } from "./binding-store.js";
import { discussionCredentialFingerprint } from "./naming.js";

export function discussionAccounts(cfg: CoreConfig): ResolvedClickClackAccount[] {
  return listEnabledClickClackAccounts(cfg).filter(
    (account) => account.configured && account.discussions.enabled,
  );
}

function isManagedMatch(account: { managedOnly?: boolean; agentId?: string }, agentId?: string) {
  return (
    account.managedOnly === true &&
    agentId !== undefined &&
    account.agentId !== undefined &&
    normalizeAgentId(account.agentId) === normalizeAgentId(agentId)
  );
}

/**
 * Select the discussion account for one agent.
 *
 * A declared managed account owns its agent even while disabled or
 * unavailable. That declaration prevents an ordinary account from becoming
 * an accidental credential/workspace fallback.
 */
export function discussionAccountsForAgent(
  cfg: CoreConfig,
  agentId?: string,
): ResolvedClickClackAccount[] {
  const accounts = discussionAccounts(cfg);
  const declaredManagedMatch = listClickClackAccountIds(cfg).some((accountId) =>
    isManagedMatch(resolveClickClackAccountConfig(cfg, accountId), agentId),
  );
  if (declaredManagedMatch) {
    return accounts.filter((account) => isManagedMatch(account, agentId));
  }
  return accounts.filter((account) => account.managedOnly !== true);
}

export function normalizedServerBaseUrl(account: ResolvedClickClackAccount): string {
  return account.baseUrl.replace(/\/+$/u, "");
}

export type DiscussionBindingAccountResolution =
  | { state: "active"; account: ResolvedClickClackAccount }
  | { state: "unavailable" }
  | { state: "stale"; account: ResolvedClickClackAccount };

/** Resolves the live account for the binding's agent and rejects older destinations. */
export function resolveDiscussionBindingAccount(
  cfg: CoreConfig,
  binding: ClickClackDiscussionBinding,
): DiscussionBindingAccountResolution {
  const accounts = discussionAccountsForAgent(cfg, binding.agentId);
  if (accounts.length !== 1) {
    return { state: "unavailable" };
  }
  const account = accounts[0];
  if (!account) {
    return { state: "unavailable" };
  }
  if (
    account.accountId !== binding.accountId ||
    normalizedServerBaseUrl(account) !== binding.serverBaseUrl ||
    account.discussions.workspace !== binding.workspaceRef ||
    (binding.credentialFingerprint !== undefined &&
      discussionCredentialFingerprint(account.token) !== binding.credentialFingerprint)
  ) {
    return { state: "stale", account };
  }
  return { state: "active", account };
}

/** Public embed/open URLs for one bound discussion channel. */
export function discussionInfoForBinding(
  binding: ClickClackDiscussionBinding,
  account: ResolvedClickClackAccount,
): SessionDiscussionInfo {
  const baseUrl = normalizedServerBaseUrl(account);
  return {
    state: "open",
    // Only this provider may opt into host-owned theme parameters; signed
    // discussion URLs from other providers must remain opaque.
    embedUrl: `${baseUrl}/embed/channel/${encodeURIComponent(binding.workspaceRouteId)}/${encodeURIComponent(binding.channelRouteId)}?openclawHostTheme=1`,
    openUrl: `${baseUrl}/app/${encodeURIComponent(binding.workspaceRouteId)}/${encodeURIComponent(binding.channelRouteId)}`,
  };
}

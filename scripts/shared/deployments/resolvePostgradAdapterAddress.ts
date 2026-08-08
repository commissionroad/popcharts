/**
 * Picks the postgrad adapter the local server must talk to.
 *
 * Two local deploys each produce a `CompleteSetPostgradAdapter`, and they are
 * different contracts at different addresses:
 *
 * - `deployLocalPregrad` always deploys a standalone one, so a `--no-postgrad`
 *   stack can still finalize graduations end to end.
 * - `deployCompleteSetPostgrad` deploys the one wired into the v4 venue (pool
 *   manager, bounded hook, order manager).
 *
 * When a venue exists the server must use the venue's adapter, or graduated
 * markets settle against a contract no pool knows about. When no venue exists
 * the standalone adapter is the only one there is.
 *
 * This precedence used to live nowhere. Two env blocks each wrote
 * `LOCAL_POSTGRAD_ADAPTER_ADDRESS` — the pregrad block from the standalone
 * deploy, the postgrad block from the venue — and the venue address survived
 * only because every composition site happened to spread the postgrad block
 * last and `readEnvFile` happens to be last-wins. Reordering two spreads, or
 * adding a site that ordered them the other way, silently repointed the server
 * at the standalone adapter. That is the env-block shadowing class of bug repo
 * PR #210 fixed on the app side. One function owns the rule now, and exactly
 * one env block writes the key.
 *
 * The blank return covers the pre-deploy boot: the orchestrators start services
 * before the deploy completes, with the same env shape and empty addresses.
 */
export function resolvePostgradAdapterAddress(
  postgrad: { readonly postgradAdapter: string } | null,
  pregradAdapterAddress: string | undefined,
): string {
  return postgrad?.postgradAdapter ?? pregradAdapterAddress ?? "";
}

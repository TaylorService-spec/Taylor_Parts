// Content-hash deduplication (item 9) + wake-only recovery (item 2). Two guards on the PAID provider call:
//
//  1. DEDUP — "do not resend when you can reference." A review request is content-addressed by the hash of
//     its request artifact. Before spending a provider call, look up whether a verified result for that
//     exact request hash already exists; if so, reuse it and count a duplicate provider call avoided.
//
//  2. WAKE-ONLY RECOVERY — the provider result is persisted as a content-addressed artifact the instant it
//     completes. If the subsequent Claude wake then fails (spawn/timeout/etc.), recovery reuses the EXACT
//     persisted result by hash and retries ONLY the wake. The provider-call count never moves — we do not
//     pay twice for a result we already have.
//
// Pure, zero-dependency ESM. The result index/store is INJECTED. Does NOT touch selector / Wake Supervisor /
// authority model / aiExchange lifecycle / provider routing / review semantics — it decides only whether a
// paid call is justified and how to recover a failed wake without one.

/** A wake is "successful" only on an explicit completion; anything else is a failed/held wake. */
export function wakeSucceeded(wakeOutcome) {
  return wakeOutcome === "SPAWNED_COMPLETED";
}

/**
 * Result cache keyed by the REQUEST content hash. Injected index is a plain Map-like ({ get, set, has }).
 * A recorded entry is the result artifact reference (identity + hash), never the substance.
 */
export function makeReviewResultCache({ index = new Map() } = {}) {
  const keyOf = (requestArtifact) => (requestArtifact && (requestArtifact.sha256 ?? requestArtifact.artifactId)) || null;
  return {
    /** @returns {resultRef|null} an existing result reference for this exact request, or null. */
    lookup(requestArtifact) {
      const k = keyOf(requestArtifact);
      if (!k) return null;
      return (typeof index.get === "function" ? index.get(k) : index[k]) || null;
    },
    record(requestArtifact, resultRef) {
      const k = keyOf(requestArtifact);
      if (!k) throw new Error("makeReviewResultCache.record: request artifact needs sha256/artifactId");
      if (typeof index.set === "function") index.set(k, resultRef);
      else index[k] = resultRef;
      return resultRef;
    },
  };
}

/**
 * Decide whether a paid provider call is justified for this request. On a dedup hit the existing result is
 * reused and duplicateProviderCallsAvoided is incremented on the passed counters (if any).
 * @returns {{ action:"REUSE_EXISTING", resultRef } | { action:"CALL_PROVIDER" }}
 */
export function planProviderCall({ requestArtifact, cache, counters = null } = {}) {
  const existing = cache ? cache.lookup(requestArtifact) : null;
  if (existing) {
    if (counters) counters.duplicateProviderCallsAvoided = (counters.duplicateProviderCallsAvoided || 0) + 1;
    return { action: "REUSE_EXISTING", resultRef: existing };
  }
  return { action: "CALL_PROVIDER" };
}

/**
 * Plan recovery after a Claude wake. If the wake failed but the provider result was already persisted, the
 * recovery is WAKE-ONLY: reuse the exact result hash, retry only the wake, spend NO additional provider call.
 * If the wake failed and no result was persisted, wake-only recovery is impossible (fail-closed to the
 * caller — a fresh cycle is required). A successful wake needs no recovery.
 * @returns {{ action, resultRef?, providerCallCountDelta, wakeOnlyRecovery, reason? }}
 */
export function planWakeRecovery({ wakeOutcome, persistedResultRef = null, counters = null } = {}) {
  if (wakeSucceeded(wakeOutcome)) {
    return { action: "NONE", providerCallCountDelta: 0, wakeOnlyRecovery: false };
  }
  if (persistedResultRef && (persistedResultRef.sha256 || persistedResultRef.artifactId)) {
    if (counters) counters.wakeOnlyRecoveries = (counters.wakeOnlyRecoveries || 0) + 1;
    return {
      action: "RETRY_WAKE_ONLY",
      resultRef: persistedResultRef,
      providerCallCountDelta: 0, // never pay again for a result we already hold
      wakeOnlyRecovery: true,
    };
  }
  return {
    action: "CANNOT_RECOVER_WAKE_ONLY",
    providerCallCountDelta: 0,
    wakeOnlyRecovery: false,
    reason: "wake failed and no provider result was persisted; a fresh cycle is required",
  };
}

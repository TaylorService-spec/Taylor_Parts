// Candidate-A (#785) FACT fixture — the independently-sufficient minimum for the benchmark's ordinary
// bounded review, replacing the legacy full-operating-model + full-diff payload. Facts + small excerpts
// only; no whole files, no transcripts, no unchanged authority. Consumed by taylor-benchmark.mjs and the
// tests. The rawEvidence excerpts are the TWO material hunks a reviewer needs — not the 10.6 KB diff.

export const SUBJECT_785_FEED = {
  reviewId: "TAYLOR-BENCH-785",
  question:
    "Does this change correctly distinguish a FAILED/denied customer read from a genuinely-absent customer " +
    "on the Equipment detail screen, without expanding write authority, and is it appropriately scoped (mirroring " +
    "the #291 Location precedent)? Answer with one verdict.",
  requirement:
    "On a failed/denied Account read, show \"Customer unavailable\" plus a Retry control; show \"Unknown customer\" " +
    "ONLY when the read succeeded and the document is confirmed absent. Firestore Rules remain the sole write " +
    "authority — this is client read-state copy only, no authority/security/architecture change.",
  implementationFacts: [
    "useAccount now returns { account, loading, error, retry }; adds an onSnapshot error callback that fails closed to a safe error and clears stale data, plus retry re-subscription and an obsolete-callback guard (single-document sibling of #291's useLocationsForAccount).",
    "New pure domain/accountSubscription.js: accountSuccessOutcome (confirmed doc or null), accountFailureOutcome (no stale record + safe loadErrorMessage copy), accountIdleOutcome (no id).",
    "EquipmentDetail Customer cell renders an inline error + Retry when accountError; \"Unknown customer\" only when the read succeeded and account is absent; the edit modal reads \"Customer unavailable\" via the derived accountName, paralleling locationName.",
    "useAccount return keys are additive — existing consumers (AccountDetail, WorkOrderDetailPage) destructure {account,loading}/{account} and are unaffected.",
  ],
  sourceFacts: [
    "#291 precedent (governing rule): a failed read must be distinguishable from \"absent\" and from \"loading\", and must never be rendered as a fact; loadErrorMessage emits safe copy that leaks no code/path/id/collection name.",
    "Authority invariant: Firestore Rules are the sole write authority; a client read-state copy change cannot expand authority or security scope.",
  ],
  deterministicEvidence: [
    "test/accountSubscription.test.mjs: 7/7 pass (success, confirmed-absent null, failure fail-closed, failure-distinct-from-absent, no-leak, actionable categories, idle).",
    "CI workflow equipment-detail-context-tests (domain outcomes + detail derived data + oxlint): pass. gitleaks: clean.",
  ],
  rawEvidence: [
    "// useAccount onSnapshot error callback (the fix):\n" +
      "const unsub = onSnapshot(doc(db, ACCOUNTS_COLLECTION, accountId),\n" +
      "  (snap) => { if (!active) return; apply(accountSuccessOutcome(snap.exists() ? { id: snap.id, ...snap.data() } : null)); },\n" +
      "  (err) => { if (!active) return; apply(accountFailureOutcome(err)); });",
    "// EquipmentDetail Customer cell (failed vs absent):\n" +
      "{accountLoading ? <span className=\"fo-muted\">Loading…</span>\n" +
      "  : accountError ? <span className=\"fo-inline-error\" role=\"alert\" data-account-error>{accountError} <button onClick={retryAccount}>Retry</button></span>\n" +
      "  : account ? <Link to={`/customers/${equipment.accountId}`}>{account.name}</Link>\n" +
      "  : <span className=\"fo-muted\">Unknown customer</span>}",
  ],
  // provenance + artifactRefs are stamped by the benchmark at build time (sourceCommit + content hashes).
};

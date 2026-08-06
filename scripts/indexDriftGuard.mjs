// O-4 — Firestore index drift guard, PURE CORE.
//
// THE RULE THIS ENFORCES: a repo-driven index deployment must NEVER silently
// delete an undeclared live index merely because the repository is considered
// authoritative.
//
// `firebase deploy --only firestore:indexes` reconciles live state to the
// declared set, so any live index absent from firestore.indexes.json is deleted
// as a side effect — with no prompt naming what is being destroyed. This module
// classifies the difference and decides whether a deploy would be destructive,
// so that decision is made deliberately and in advance rather than discovered
// afterwards.
//
// PURE: no network, filesystem, or process access. Callers supply both sides.

/** Canonical comparison key for an index: collection group + ordered fields. */
export function indexKey(index) {
  const group = index.collectionGroup ?? '';
  const scope = index.queryScope ?? 'COLLECTION';
  const fields = (index.fields ?? [])
    // __name__ is appended implicitly by Firestore and is not part of a
    // declaration, so including it would make every live index look undeclared.
    .filter((f) => f.fieldPath !== '__name__')
    .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? f.vectorConfig ?? 'ASC'}`)
    .join(',');
  return `${group}|${scope}|${fields}`;
}

/**
 * Compare declared (repo) against live indexes.
 *
 * `wouldDelete` is the set a deploy would DESTROY: live indexes with no
 * declaration. That is the destructive class and the reason this guard exists.
 * `wouldCreate` is additive and safe.
 */
export function compareIndexes({ declared = [], live = [] } = {}) {
  const declaredMap = new Map(declared.map((i) => [indexKey(i), i]));
  const liveMap = new Map(live.map((i) => [indexKey(i), i]));

  const wouldDelete = [];
  for (const [key, index] of liveMap) {
    if (!declaredMap.has(key)) wouldDelete.push({ key, index });
  }
  const wouldCreate = [];
  for (const [key, index] of declaredMap) {
    if (!liveMap.has(key)) wouldCreate.push({ key, index });
  }
  const unchanged = [...declaredMap.keys()].filter((k) => liveMap.has(k));

  return {
    declaredCount: declaredMap.size,
    liveCount: liveMap.size,
    wouldDelete,
    wouldCreate,
    unchangedCount: unchanged.length,
    destructive: wouldDelete.length > 0,
  };
}

/**
 * Decide whether a deploy may proceed.
 *
 * FAILS CLOSED: a destructive deploy is BLOCKED unless the caller passes an
 * explicit acknowledgement listing every index to be deleted. A blanket
 * "--force" is deliberately not offered — the authorization must name what it
 * destroys, so it cannot be given without knowing.
 */
export function evaluateDeploy(comparison, { acknowledgedDeletions = [] } = {}) {
  if (!comparison.destructive) {
    return { allowed: true, reason: 'NON_DESTRUCTIVE', unacknowledged: [] };
  }
  const acknowledged = new Set(acknowledgedDeletions);
  const unacknowledged = comparison.wouldDelete
    .map((d) => d.key)
    .filter((k) => !acknowledged.has(k));

  if (unacknowledged.length > 0) {
    return {
      allowed: false,
      reason: 'DESTRUCTIVE_UNACKNOWLEDGED',
      unacknowledged,
    };
  }
  return { allowed: true, reason: 'DESTRUCTIVE_ACKNOWLEDGED', unacknowledged: [] };
}

/** Normalize `gcloud firestore indexes composite list --format=json` output. */
export function normalizeGcloudIndexes(raw) {
  return (raw ?? []).map((i) => ({
    collectionGroup:
      i.collectionGroup ??
      (typeof i.name === 'string' ? i.name.split('/collectionGroups/')[1]?.split('/')[0] : undefined),
    queryScope: i.queryScope ?? 'COLLECTION',
    fields: (i.fields ?? []).map((f) => ({
      fieldPath: f.fieldPath,
      ...(f.order ? { order: f.order } : {}),
      ...(f.arrayConfig ? { arrayConfig: f.arrayConfig } : {}),
    })),
  }));
}

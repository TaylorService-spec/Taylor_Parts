// THE DURABLE STORE — a technician's queue and cache, surviving the phone.
//
// ============================ WHY AN ADAPTER AND NOT JUST IndexedDB ============================
//
// Every decision in this file — schema, migration, principal scoping, what may be cached, what a
// failed write means — is storage-independent. IndexedDB is one implementation of a three-method
// interface (get / set / remove), and it is deliberately the smallest part of this module.
//
// That is not testing convenience. It is that the interesting failures are all above the storage
// layer: a queue restored under the wrong user, a schema a newer build wrote, a save that silently
// did not happen. Those are provable against an in-memory adapter and are the same bugs whichever
// engine is underneath.
//
// ============================ ONE STORE PER PRINCIPAL ============================
//
// The key is namespaced by uid, and the RECORD carries the uid as well. Both, on purpose: the key
// prevents two accounts sharing a queue, and the stored uid catches the case where they somehow do.
// A record whose principal does not match the session is refused — not migrated, not merged, not
// adopted. One person's queued work is never sent under another person's authority.
//
// A record for a different principal is also NOT DELETED. It belongs to whoever queued it, and they
// may sign back in on this device and still need it.
//
// ============================ A FAILED SAVE IS NEWS ============================
//
// `saveQueue` reports whether the write actually became durable. A phone whose storage is full, whose
// quota is exhausted, or which is in a private mode that refuses persistence must not be told
// "Pending sync" — that phrase promises the work is safe on the device, and it would not be.
//
// The caller is expected to surface `durable: false` BEFORE the technician walks away. See §26 of
// docs/architecture/technician-offline-runtime.md.
//
// ============================ IT IS NOT ENCRYPTED ============================
//
// IndexedDB and localStorage are not application-encrypted, and this module does not pretend
// otherwise. Cached work orders, customer names and site addresses are business data at rest on a
// device, protected by the device's own lock screen and by nothing else this code does. Credentials
// never enter it — enforced at capture by technicianIntent.js, not by convention.

export const STORE_NAMESPACE = "eos.tech.offline";

/**
 * The local schema version.
 *
 * ONE, because there has been exactly one shape of this store and pretending otherwise would be
 * fiction. What matters before a second version exists is that the MECHANISM works, so `migrations`
 * is a real injected registry rather than something to be written later under field pressure — see
 * test/offlineLocalStore.test.mjs, which migrates a v1 record to a v2 and asserts pending intents
 * survive it.
 */
export const SCHEMA_VERSION = 1;

/**
 * What a technician's device is allowed to hold.
 *
 * A closed list, because the cheap mistake here is caching "everything the screen needed" and ending
 * up with a copy of the CRM on a phone. Each kind below exists because an assigned job cannot be
 * worked without it.
 */
export const CACHE_KIND = Object.freeze({
  WORK_ORDER: "WORK_ORDER",
  WORK_ORDER_CONTEXT: "WORK_ORDER_CONTEXT",
  PARTS_READINESS: "PARTS_READINESS",
  INSTALLABLE_EQUIPMENT: "INSTALLABLE_EQUIPMENT",
  LABOR_SUMMARY: "LABOR_SUMMARY",
});

export const CACHE_KINDS = Object.freeze(Object.values(CACHE_KIND));

const emptyRecord = (principalUid) => Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  principalUid,
  intents: Object.freeze([]),
  cache: Object.freeze({}),
  updatedAtLocal: 0,
});

/** Why a load returned nothing. Absence and refusal are different facts and never collapse. */
export const LOAD_OUTCOME = Object.freeze({
  EMPTY: "EMPTY",
  LOADED: "LOADED",
  /** Stored under a different principal. Left alone, not adopted. */
  FOREIGN_PRINCIPAL: "FOREIGN_PRINCIPAL",
  /** Written by a newer build. Left alone, not downgraded. */
  FUTURE_SCHEMA: "FUTURE_SCHEMA",
  /** Unreadable. The queue is gone; saying so beats pretending it was empty. */
  CORRUPT: "CORRUPT",
  /** Storage itself is unavailable. Nothing will be durable this session. */
  UNAVAILABLE: "UNAVAILABLE",
});

// ============================ ADAPTERS ============================

/** Memory. Honest about itself: nothing here survives the tab. */
export function memoryAdapter() {
  const map = new Map();
  return {
    kind: "memory",
    durable: false,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

/** localStorage. Durable, small, synchronous, and the first thing to hit a quota. */
export function localStorageAdapter(storage) {
  return {
    kind: "localStorage",
    durable: true,
    async get(key) { return storage.getItem(key); },
    async set(key, value) { storage.setItem(key, value); },
    async remove(key) { storage.removeItem(key); },
  };
}

const IDB_DB = "eos-technician-offline";
const IDB_STORE = "records";

/**
 * IndexedDB. The real one, and deliberately thin — three operations and no logic.
 *
 * Everything that could be wrong about the DATA is decided above this line, so this layer has almost
 * nothing to get wrong. Requests are wrapped one at a time rather than batched: a technician's queue
 * is one record, and a transaction per operation costs nothing at that size.
 */
export function indexedDbAdapter(factory) {
  const open = () => new Promise((resolve, reject) => {
    const request = factory.open(IDB_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = (mode, fn) => open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result ?? null); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
  return {
    kind: "indexedDB",
    durable: true,
    get: (key) => run("readonly", (s) => s.get(key)),
    set: (key, value) => run("readwrite", (s) => s.put(value, key)).then(() => undefined),
    remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
  };
}

/**
 * Pick the best storage this device actually offers.
 *
 * The order is durability first. Memory is last and is a REAL outcome, not a failure to handle
 * later: a browser in a locked-down private mode genuinely has nowhere durable to write, and the
 * technician has to be told that before they rely on it.
 */
export function selectAdapter(globals = {}) {
  const { indexedDB: idb, localStorage: ls } = globals;
  if (idb && typeof idb.open === "function") {
    try { return indexedDbAdapter(idb); } catch { /* fall through */ }
  }
  if (ls && typeof ls.setItem === "function") {
    try {
      // Probe rather than assume. Safari's private mode exposes localStorage and throws on write.
      ls.setItem(`${STORE_NAMESPACE}.probe`, "1");
      ls.removeItem(`${STORE_NAMESPACE}.probe`);
      return localStorageAdapter(ls);
    } catch { /* fall through */ }
  }
  return memoryAdapter();
}

// ============================ THE STORE ============================

/**
 * @param adapter    a { get, set, remove } as above.
 * @param migrations { [fromVersion]: (record) => record }, applied in sequence up to `targetVersion`.
 * @param targetVersion the version this build understands. Defaults to SCHEMA_VERSION.
 */
export function createIntentStore({ adapter, migrations = {}, targetVersion = SCHEMA_VERSION } = {}) {
  const keyFor = (principalUid) => `${STORE_NAMESPACE}/${principalUid}`;

  /**
   * Bring a stored record up to the version this build speaks.
   *
   * Forward only. A record from a NEWER build is refused rather than downgraded: this build cannot
   * know what a future field means, and dropping it to fit an older shape would silently destroy
   * whatever it was. The device keeps the record and this session runs without it.
   */
  function migrate(record) {
    let current = record;
    let guard = 0;
    while (current.schemaVersion < targetVersion) {
      const step = migrations[current.schemaVersion];
      if (typeof step !== "function") return { ok: false, outcome: LOAD_OUTCOME.CORRUPT };
      current = step(current);
      // A migration that fails to advance the version would spin here forever, on a technician's
      // phone, at the moment they open the app. Bounded so that a bad migration is a visible refusal.
      guard += 1;
      if (guard > 50) return { ok: false, outcome: LOAD_OUTCOME.CORRUPT };
    }
    return { ok: true, record: current };
  }

  return {
    adapterKind: adapter.kind,
    /** False means nothing written this session survives the app closing. The UI must say so. */
    durable: adapter.durable === true,

    async load(principalUid) {
      let raw;
      try {
        raw = await adapter.get(keyFor(principalUid));
      } catch {
        return { outcome: LOAD_OUTCOME.UNAVAILABLE, record: emptyRecord(principalUid) };
      }
      if (!raw) return { outcome: LOAD_OUTCOME.EMPTY, record: emptyRecord(principalUid) };

      let parsed;
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return { outcome: LOAD_OUTCOME.CORRUPT, record: emptyRecord(principalUid) };
      }
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.intents)) {
        return { outcome: LOAD_OUTCOME.CORRUPT, record: emptyRecord(principalUid) };
      }
      // Belt and braces: the key already scopes by principal, and this catches the case where it
      // somehow did not. Refused, never adopted — one person's work is never sent as another's.
      if (parsed.principalUid !== principalUid) {
        return { outcome: LOAD_OUTCOME.FOREIGN_PRINCIPAL, record: emptyRecord(principalUid) };
      }
      if (parsed.schemaVersion > targetVersion) {
        return { outcome: LOAD_OUTCOME.FUTURE_SCHEMA, record: emptyRecord(principalUid) };
      }
      const migrated = migrate(parsed);
      if (!migrated.ok) return { outcome: migrated.outcome, record: emptyRecord(principalUid) };
      return {
        outcome: LOAD_OUTCOME.LOADED,
        record: Object.freeze({
          ...migrated.record,
          schemaVersion: targetVersion,
          intents: Object.freeze(migrated.record.intents.map((i) => Object.freeze(i))),
          cache: Object.freeze(migrated.record.cache ?? {}),
        }),
      };
    },

    /**
     * Persist. Returns whether it actually became durable, and why not if it did not.
     *
     * Never throws. A storage failure on a phone in a plant room must degrade to a visible warning,
     * not an exception that takes down the screen the technician is standing in front of.
     */
    async save(principalUid, { intents = [], cache = {} } = {}, at = 0) {
      const record = {
        schemaVersion: targetVersion, principalUid, intents, cache, updatedAtLocal: at,
      };
      try {
        await adapter.set(keyFor(principalUid), JSON.stringify(record));
        return { durable: adapter.durable === true, reason: adapter.durable ? null : "storage_not_durable" };
      } catch (err) {
        const name = err?.name ?? "";
        return {
          durable: false,
          reason: name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
            ? "quota_exceeded" : "write_failed",
        };
      }
    },

    /**
     * Clear this principal's local state.
     *
     * Called on an explicit "discard my queued work", never on logout: signing out does not mean
     * abandoning the day's work, and deleting it because somebody switched accounts would be the
     * single worst thing this runtime could do.
     */
    async clear(principalUid) {
      try { await adapter.remove(keyFor(principalUid)); return true; } catch { return false; }
    },
  };
}

/**
 * A cached server record, stamped with everything needed to distrust it later.
 *
 * Provenance is not bookkeeping. A technician looking at a job on a phone with no signal is looking
 * at a photograph, and the difference between a photograph and a live view is the whole reason this
 * runtime can be trusted: `fetchedAt` is what lets a screen say "as of 9:15 this morning" instead of
 * implying it is current.
 *
 * `serverVersion` carries whatever update marker the projection exposed, and null is a legitimate
 * answer — several of these projections have no version field, and inventing one would be worse than
 * admitting we cannot tell whether the server has moved.
 */
export function cacheEntry({
  kind, serverId, data, fetchedAt = 0, serverVersion = null, source = null, principalUid = null,
} = {}) {
  if (!CACHE_KINDS.includes(kind)) return { valid: false, reason: "unknown_cache_kind" };
  if (typeof serverId !== "string" || serverId.trim() === "") return { valid: false, reason: "server_id_required" };
  return {
    valid: true,
    value: Object.freeze({
      kind, serverId, data, fetchedAt, serverVersion, source, principalUid,
    }),
  };
}

/** How old is this, and should a screen say so? */
export function cacheAge(entry, now = 0) {
  const fetchedAt = entry?.fetchedAt ?? 0;
  return { millis: Math.max(0, now - fetchedAt), fetchedAt };
}

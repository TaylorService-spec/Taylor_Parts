// KNOWN NON-MIGRATED REORDER FIXTURES: the five pre-existing Sample Company v2 purchasing records the Reorder cutover
// VERIFY recognizes and leaves alone (Controller ruling "REORDER SAMPLE COMPANY FIXTURE RECONCILIATION", 2026-09-30,
// Option B -- the catalogKnownFixtures.ts pattern extended to Reorder).
//
// `taylor-nonprod` holds two NATIVE Reorder Requests, their two Purchase Orders and one void seeded on 2026-09-16 by
// scripts/seedSampleCompany.js (key `sample-co-synthetic`, actor columns carrying the operator string `rudy`). They are
// not Taylor business records and not migration candidates. `sample-co-synthetic` stays unbound and `rudy` stays what
// it is: for THESE FIVE RECORDS ONLY, ACTOR_NOT_ACTIVE_MEMBER and COMPANY_KEY_NOT_GOVERNED are fixture
// characteristics. Everywhere else the purchasing verify is unchanged and still fails closed on both.
//
// THIS IS NOT "ignore synthetic / Sample Company / unbound company / inactive actor". A target row is a known fixture only
// when ALL hold: the pinned tenant; a pinned id; its canonical fingerprint -- sha256 of to_jsonb(row)::text under
// TimeZone UTC, so every column (actor, company key, status, relationships, business fields) is pinned -- equals the
// pinned one; and the pinned relationships (each PO shares its request's id; the void names the pinned voided PO) hold.
// The set is exact: a changed, missing or additional Sample Company record REFUSES. And the VERIFY now also refuses any
// target Reorder / PO / void that is neither in the (exclusion-filtered) snapshot nor a pinned fixture.
import type { PoolClient } from "pg";

export const KNOWN_NON_MIGRATED_FIXTURE = "KNOWN_NON_MIGRATED_FIXTURE";
export const REORDER_FIXTURE_TENANT_ID = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
export const SAMPLE_COMPANY_FIXTURE_COMPANY_KEY = "sample-co-synthetic";

export interface PinnedRow { readonly id: string; readonly fingerprint: string }

/** Measured read-only on eos-api-nonprod 2026-09-30 with `fingerprintSql` below. */
export const KNOWN_REORDER_FIXTURES = Object.freeze({
  reorderRequests: Object.freeze([
    { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "27eb1d62753bb7adfd6e086debe4cafd2fb25dc045ec7b1cd18f72481dd9c1f4" },
    { id: "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af", fingerprint: "79908c3dfaaf47a8777010d7ce9940856fad25ef59429c14f5de5c470aa98ee0" },
  ] as readonly PinnedRow[]),
  purchaseOrders: Object.freeze([
    { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "35398321f84ba20f037c100cac5f31543db5999b9632ced5b8702875de1d616d" },
    { id: "rr_f7090a49-f1b1-40cf-8bde-c7d9a69574af", fingerprint: "0dd2b89a22cc4723c48c127911813fddf4518a077d4f352276eae7bfcc906245" },
  ] as readonly PinnedRow[]),
  /** A void's identity is the purchase order it voids. */
  voids: Object.freeze([
    { id: "rr_ab54d29e-ab43-4792-9e7f-4c8b9fc771ae", fingerprint: "be793be7b1f923a730ecd02d526ddb5d3fdbd38719d7315437561f2eed29a11b" },
  ] as readonly PinnedRow[]),
});

type Kind = "reorderRequests" | "purchaseOrders" | "voids";
const TABLES: Readonly<Record<Kind, { table: string; idColumn: string }>> = Object.freeze({
  reorderRequests: { table: "reorder_requests", idColumn: "id" },
  purchaseOrders: { table: "purchase_orders", idColumn: "id" },
  voids: { table: "purchase_order_voids", idColumn: "purchase_order_id" },
});

export interface ReorderTargetClassification {
  readonly known: Readonly<Record<Kind, readonly { readonly id: string; readonly classification: typeof KNOWN_NON_MIGRATED_FIXTURE; readonly fingerprint: string }[]>>;
  /** Target rows neither in the snapshot nor pinned fixtures. Non-empty means REFUSE. */
  readonly unknown: Readonly<Record<Kind, readonly string[]>>;
  /** The pinned fixture set is not exactly as pinned. Non-empty means REFUSE. */
  readonly refusals: readonly string[];
}

/** The canonical fingerprint, computed by PostgreSQL. The caller's transaction must run with TimeZone UTC. */
const fingerprintSql = (table: string, idColumn: string): string =>
  `SELECT t.${idColumn} AS id, t.operating_company_key AS key,
          encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS fingerprint
     FROM eos_ops.${table} t WHERE t.tenant_id = $1 ORDER BY 1`;

/**
 * Classify every target Reorder / PO / void row the snapshot does not account for. READ ONLY; runs in its own
 * READ ONLY transaction with TimeZone UTC so the fingerprint does not depend on the session.
 */
export async function classifyReorderTarget(
  client: PoolClient,
  tenantId: string,
  sourceIds: Readonly<Record<Kind, ReadonlySet<string>>>,
): Promise<ReorderTargetClassification> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TimeZone = 'UTC'");
    const pinnedTenant = tenantId === REORDER_FIXTURE_TENANT_ID;
    const known: Record<Kind, { id: string; classification: typeof KNOWN_NON_MIGRATED_FIXTURE; fingerprint: string }[]> = { reorderRequests: [], purchaseOrders: [], voids: [] };
    const unknown: Record<Kind, string[]> = { reorderRequests: [], purchaseOrders: [], voids: [] };
    const refusals: string[] = [];
    const present: Record<Kind, Set<string>> = { reorderRequests: new Set(), purchaseOrders: new Set(), voids: new Set() };
    for (const kind of Object.keys(TABLES) as Kind[]) {
      const pins = new Map(KNOWN_REORDER_FIXTURES[kind].map((p) => [p.id, p.fingerprint]));
      const rows = (await client.query(fingerprintSql(TABLES[kind].table, TABLES[kind].idColumn), [tenantId])).rows as { id: string; key: string; fingerprint: string }[];
      for (const r of rows) {
        present[kind].add(r.id);
        if (sourceIds[kind].has(r.id)) continue;
        const pin = pinnedTenant ? pins.get(r.id) : undefined;
        if (pin !== undefined) {
          if (r.fingerprint === pin) known[kind].push({ id: r.id, classification: KNOWN_NON_MIGRATED_FIXTURE, fingerprint: r.fingerprint });
          else refusals.push(`${TABLES[kind].table} ${r.id} is a pinned fixture but its content changed`);
        } else if (r.key === SAMPLE_COMPANY_FIXTURE_COMPANY_KEY) {
          refusals.push(`${TABLES[kind].table} ${r.id} is a Sample Company record that is not a pinned fixture`);
        } else {
          unknown[kind].push(r.id);
        }
      }
    }
    // THE SET IS EXACT, and so are its relationships. Checked only where the fixtures live: a tenant holding none of
    // them (production, a test tenant) has nothing to prove.
    const anyPinnedPresent = (Object.keys(TABLES) as Kind[]).some((k) => KNOWN_REORDER_FIXTURES[k].some((p) => present[k].has(p.id)));
    if (pinnedTenant && anyPinnedPresent) {
      for (const kind of Object.keys(TABLES) as Kind[]) {
        for (const p of KNOWN_REORDER_FIXTURES[kind]) if (!present[kind].has(p.id)) refusals.push(`pinned fixture ${TABLES[kind].table} ${p.id} is missing`);
      }
      const knownIds = (k: Kind) => new Set(known[k].map((x) => x.id));
      for (const po of KNOWN_REORDER_FIXTURES.purchaseOrders) {
        if (knownIds("purchaseOrders").has(po.id) && !knownIds("reorderRequests").has(po.id)) refusals.push(`pinned purchase order ${po.id} is not paired with its pinned request`);
      }
      for (const v of KNOWN_REORDER_FIXTURES.voids) {
        if (knownIds("voids").has(v.id) && !knownIds("purchaseOrders").has(v.id)) refusals.push(`pinned void ${v.id} does not name its pinned purchase order`);
      }
    }
    await client.query("COMMIT");
    return Object.freeze({ known: Object.freeze(known), unknown: Object.freeze(unknown), refusals: Object.freeze(refusals) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

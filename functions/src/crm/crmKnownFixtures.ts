// PINNED CRM FIXTURES (Controller "OVERNIGHT COMMERCIAL / CRM ACTIVATION PACKAGE", 2026-09-30, rulings D1/D2/D3).
//
// SOURCE (Firestore snapshot) records EXCLUDED from the governed CRM business-data copy -- each pinned by collection, id
// and a canonical fingerprint of its stored data (sha256 of sorted-key JSON). A pinned id whose data changed is a
// BLOCKING finding, never a silent exclusion:
//   D1 DATA_IMPORT_ACCEPTANCE_FIXTURE -- the two Data Import acceptance Accounts and their two acceptance sites. Their
//      free-text billing addresses are never parsed or fabricated; they never become Taylor customers.
//   D2 SANDBOX_SEED_FIXTURE -- the owner-underivable sandbox-baseline-seed children of acct-harbor / acct-summit. No owner
//      is invented. (The parent Accounts stay governed COPY candidates under the ownerless-Account ruling; this does NOT
//      establish that real Contacts or sites may be ownerless.)
//
// TARGET (eos_crm) rows PRESERVED as KNOWN_NON_MIGRATED_FIXTURE (D3) -- the 14 declared synthetic seed rows of the two
// governed seed manifests (syntheticNonprodWorkforceSeed.v1.json, sampleCompany.v2.json), each pinned by id and
// PostgreSQL-canonical fingerprint sha256(to_jsonb(row)::text) under TimeZone UTC, in the pinned tenant only. A changed,
// missing or additional one refuses; any other unknown target row is still TARGET_HAS_UNKNOWN_RECORDS.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type CrmFixtureCollection = "accounts" | "contacts" | "locations";
export const KNOWN_NON_MIGRATED_FIXTURE = "KNOWN_NON_MIGRATED_FIXTURE";
export const CRM_FIXTURE_TENANT_ID = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";

export interface PinnedSourceExclusion {
  readonly collection: CrmFixtureCollection;
  readonly id: string;
  readonly classification: "DATA_IMPORT_ACCEPTANCE_FIXTURE" | "SANDBOX_SEED_FIXTURE";
  readonly ruling: "D1" | "D2";
  readonly fingerprint: string;
}

/** Measured from FP-CRM-0 (eos-platform-sandbox, 2026-09-30) with `sourceFingerprint` below. */
export const PINNED_SOURCE_EXCLUSIONS: readonly PinnedSourceExclusion[] = Object.freeze([
  { collection: "accounts", id: "IMP-ACCEPTANCE-ICE-CO-NQX1QO-1OSKNMX", classification: "DATA_IMPORT_ACCEPTANCE_FIXTURE", ruling: "D1", fingerprint: "49d0862ae701db4a4ed5f5c20a326e3d05cca65de158c50a5801ac24a61e7d03" },
  { collection: "accounts", id: "IMP-ACCEPTANCE-ICE-CO-NUBQGX-0NLDR0W", classification: "DATA_IMPORT_ACCEPTANCE_FIXTURE", ruling: "D1", fingerprint: "6d86091d0d322b4ee8e123ec70ce902cacbafa6ce83faca990c3d18f6759875e" },
  { collection: "locations", id: "acc-loc-NQX1QO", classification: "DATA_IMPORT_ACCEPTANCE_FIXTURE", ruling: "D1", fingerprint: "a32705eb87a89c8c069e4b5aa4bdf35ebc6c6cdd6155408c6adcc953136e58b0" },
  { collection: "locations", id: "acc-loc-NUBQGX", classification: "DATA_IMPORT_ACCEPTANCE_FIXTURE", ruling: "D1", fingerprint: "44307b125b3a19e0350f34d876f51477d94937929f5b5d0c36d408e044440d79" },
  { collection: "contacts", id: "con-harbor-gm", classification: "SANDBOX_SEED_FIXTURE", ruling: "D2", fingerprint: "cb39e14870d86ec07c7d61f90d383e3a1e77a1c0ae793de4a33bcde0291068a9" },
  { collection: "contacts", id: "con-summit-ops", classification: "SANDBOX_SEED_FIXTURE", ruling: "D2", fingerprint: "be2ced4c5cf61bfc6430874a86987bc23f782d3e053de540ea0d3e3259b3b6f1" },
  { collection: "locations", id: "loc-harbor-airport", classification: "SANDBOX_SEED_FIXTURE", ruling: "D2", fingerprint: "a8a32e1d2fb55ff78aa4df3125942079039e03d6e9715f8a39f08bcef095b475" },
  { collection: "locations", id: "loc-harbor-downtown", classification: "SANDBOX_SEED_FIXTURE", ruling: "D2", fingerprint: "eec8439872b7359e4184fc7e1dd9e7e493091777e85a06d2a30c37619fa9ce4f" },
  { collection: "locations", id: "loc-summit-flag", classification: "SANDBOX_SEED_FIXTURE", ruling: "D2", fingerprint: "f8dcd0b8a1a6db80a55c93147a7b43eb35149249c3ca7bca7704ed442ac815e8" },
].map((x) => Object.freeze(x as PinnedSourceExclusion)));

const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical)
  : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v);

/** The source record's canonical fingerprint: sha256 of its stored data as sorted-key JSON. */
export function sourceFingerprint(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(data))).digest("hex");
}

export function pinnedSourceExclusion(collection: CrmFixtureCollection, id: string): PinnedSourceExclusion | undefined {
  return PINNED_SOURCE_EXCLUSIONS.find((p) => p.collection === collection && p.id === id);
}

export interface PinnedTargetFixture {
  readonly collection: CrmFixtureCollection;
  readonly id: string;
  readonly manifest: "syntheticNonprodWorkforceSeed.v1.json" | "sampleCompany.v2.json";
  readonly fingerprint: string;
}

/** Measured read-only on eos-api-nonprod 2026-09-30 with verifyPinnedTargetFixtures' fingerprint (sha256 of to_jsonb(row)::text, TimeZone UTC). */
export const PINNED_TARGET_FIXTURES: readonly PinnedTargetFixture[] = Object.freeze([
  { collection: "accounts", id: "sample-co-acct-retail-b", manifest: "sampleCompany.v2.json", fingerprint: "f6426a72f8e7af7ff214296ecee06db1db7f83f5bd82e4fcc8655e4dd6fdfa33" },
  { collection: "accounts", id: "synthetic-np-acct-national", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "4f1f3f4b4599dbfa1425b8af66ad5d2a0523e80418da5170dfcb2a0c4c2c1b5f" },
  { collection: "accounts", id: "synthetic-np-acct-retail", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "18424de25f961a67657a3c8f60c41c445f86693b6c5adeeebdd32125c4769a3d" },
  { collection: "contacts", id: "sample-co-contact-national-ap", manifest: "sampleCompany.v2.json", fingerprint: "9ed020fbcf577baf1d957ee98aceccf3d81e50bdd8feb84ede7615b8add9d5ad" },
  { collection: "contacts", id: "sample-co-contact-national-regional", manifest: "sampleCompany.v2.json", fingerprint: "823d6b12102e817e7b3768821187a9cab59bb5f401ac75b77e134787f8f22c97" },
  { collection: "contacts", id: "sample-co-contact-retail-b", manifest: "sampleCompany.v2.json", fingerprint: "78f56bbf88c9ad4acd9bb2d63b99c2b0384c669f617475034d96bb794f735ddb" },
  { collection: "contacts", id: "sample-co-contact-retail-secondary", manifest: "sampleCompany.v2.json", fingerprint: "0f55538e84442ad2e45c17b3d8787194b8d1dc7b716a7e892e699aca509f2269" },
  { collection: "contacts", id: "synthetic-np-contact-national", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "2d4642143267f0aa9bad86ac8bb080c95206efe0cbb7faf549cb8cd551c27dcb" },
  { collection: "contacts", id: "synthetic-np-contact-retail", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "0aacdd6b6cc8639ccb7f131cd3e1b994c015360b4ff60b2abc4e1f6d107c1013" },
  { collection: "locations", id: "sample-co-loc-national-north", manifest: "sampleCompany.v2.json", fingerprint: "cffd67ba1ac9c8d2e48ca034d0e3830bc9ee7bd1afca01ee5db72c407f5d63d2" },
  { collection: "locations", id: "sample-co-loc-national-south", manifest: "sampleCompany.v2.json", fingerprint: "01d79ffdb1cc5b4b27355a8ef647ba80a9b8ce7e06c491e07d61de4e9b749189" },
  { collection: "locations", id: "sample-co-loc-retail-b", manifest: "sampleCompany.v2.json", fingerprint: "1c2339389bb230a54bc8300e3b0ec647113d7491e224b1997ac332bf4b8cc873" },
  { collection: "locations", id: "synthetic-np-loc-national", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "67b766bca9ae532e847b2ad3148b2bd0fa7f422949985a7d8f35e3e44c6a3151" },
  { collection: "locations", id: "synthetic-np-loc-retail", manifest: "syntheticNonprodWorkforceSeed.v1.json", fingerprint: "6523a69a740326ae84f90429cffe41b84a62abf00f3024045a9cd4d33e2eb0d7" },
].map((x) => Object.freeze(x as PinnedTargetFixture)));

const TARGET_TABLE: Readonly<Record<CrmFixtureCollection, string>> = Object.freeze({
  accounts: "eos_crm.accounts", contacts: "eos_crm.contacts", locations: "eos_crm.account_locations",
});

/** The pinned target ids per collection -- the ids the copy may retain (and nothing else). */
export function pinnedTargetIds(): Readonly<Record<CrmFixtureCollection, readonly string[]>> {
  const of = (c: CrmFixtureCollection) => PINNED_TARGET_FIXTURES.filter((p) => p.collection === c).map((p) => p.id);
  return Object.freeze({ accounts: of("accounts"), contacts: of("contacts"), locations: of("locations") });
}

/**
 * Prove the tenant's pinned target fixtures are exactly present and unchanged. Runs on the caller's client (inside its
 * transaction) with a transaction-local TimeZone UTC. Returns refusal strings; empty = every pin holds. A tenant other
 * than the pinned one holds no known fixture: any pinned id there is a refusal.
 */
export async function verifyPinnedTargetFixtures(client: Pick<PoolClient, "query">, tenantId: string): Promise<readonly string[]> {
  await client.query("SET LOCAL TimeZone = 'UTC'");
  const refusals: string[] = [];
  for (const collection of ["accounts", "contacts", "locations"] as const) {
    const pins = PINNED_TARGET_FIXTURES.filter((p) => p.collection === collection);
    const { rows } = await client.query(
      `SELECT t.id, encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS fingerprint
         FROM ${TARGET_TABLE[collection]} t WHERE t.tenant_id = $1 AND t.id = ANY($2::text[])`,
      [tenantId, pins.map((p) => p.id)]);
    const got = new Map((rows as { id: string; fingerprint: string }[]).map((r) => [r.id, r.fingerprint]));
    if (tenantId !== CRM_FIXTURE_TENANT_ID) {
      for (const id of got.keys()) refusals.push(`${collection} ${id} is a pinned fixture id outside the pinned tenant`);
      continue;
    }
    for (const p of pins) {
      if (!got.has(p.id)) refusals.push(`pinned fixture ${collection} ${p.id} is missing`);
      else if (got.get(p.id) !== p.fingerprint) refusals.push(`pinned fixture ${collection} ${p.id} changed`);
    }
  }
  return Object.freeze(refusals);
}

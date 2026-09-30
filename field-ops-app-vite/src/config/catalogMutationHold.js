// THE DQ-034 CATALOG MUTATION HOLD -- the client's mirror of the server's committed hold
// (functions/src/catalogMaster/catalogWriterState.ts CATALOG_MUTATION_HOLD).
//
// PostgreSQL is the Catalog READ authority, and every PostgreSQL Catalog MUTATION is held while an active release
// journey still reads the frozen Firebase catalog. The server refuses every mutation with CATALOG_MUTATION_HELD
// regardless of what this file says; this mirror exists so no screen OFFERS a change the server will refuse, and so
// every catalog editing surface says the same true sentence about why.
//
// A CODE CONSTANT, NOT READINESS. It is deliberately not in config/environments.json: readiness is per environment,
// and the hold is not -- it is lifted everywhere at once, by a reviewed change to BOTH this file and the server's
// constant (test/catalogMutationHold.test.jsx pins the two together). There is no runtime override; tests that need
// the unheld branch mock this module (vi.mock), which introduces no production-importable bypass.
//
// Consumers read `CATALOG_MUTATION_HOLD.held` at render/call time (never a copy taken at import), so a module mock
// is honoured.
export const CATALOG_MUTATION_HOLD = Object.freeze({
  held: true,
  ruling: "DQ-034",
  reason: "DQ-034: active release-journey readers still read the frozen Firebase catalog",
});

/** The server's stable refusal code (catalogHttp.ts), carried as `reason` by services/catalogApiClient.js. */
export const CATALOG_MUTATION_HELD_CODE = "CATALOG_MUTATION_HELD";

/** The short form, for a locked control's reason / title. */
export const CATALOG_MUTATION_PAUSED_REASON = "Catalog changes are paused during the migration";

/** The one sentence every catalog editing surface shows while the hold is on. */
export const CATALOG_MUTATION_PAUSED_MESSAGE =
  "Catalog changes are paused during the migration. You can still look up and review parts; creating, editing, "
  + "status changes and identifier changes resume once the migration completes.";

/** The outcome a held mutation resolves to -- never a callable attempt, never a claimed success. */
export const CATALOG_MUTATION_HELD_OUTCOME = Object.freeze({
  kind: "unavailable",
  held: true,
  message: CATALOG_MUTATION_PAUSED_MESSAGE,
});

/** Is this refusal the server's DQ-034 hold? Accepts a thrown error, a catalogApiClient failure, or a bare code. */
export function isCatalogMutationHeldRefusal(refusal) {
  if (refusal === CATALOG_MUTATION_HELD_CODE) return true;
  return Boolean(refusal) && typeof refusal === "object"
    && (refusal.reason === CATALOG_MUTATION_HELD_CODE || refusal.code === CATALOG_MUTATION_HELD_CODE);
}

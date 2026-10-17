// Manufacturer catalog READ and WRITES, through the GOVERNED RENDER CATALOG API (Firebase exit F5).
//
//   browser -> services/catalogApiClient.js -> POST /operations/catalog -> eos_ops.manufacturers
//
// Replaces the getManufacturerCatalog callable client, and brings back the create / rename / status flow
// Firebase exit PR-B removed, on the PostgreSQL writer (functions/src/catalogMaster/postgresManufacturerWriter.ts).
// No fallback to Firebase: a refused or failed call is a value the screen renders.
//
// Authority is the server's: the list needs inventory.catalog.read AND inventory.manufacturer.read; create and
// rename need inventory.catalog.manage; status needs inventory.catalog.activate. Nothing here decides who may.

// LAZY, like the callable client it replaces: catalogApiClient reaches adminPolicyApiClient, whose import initializes the
// Firebase app. manufacturerQueries.js (and every Part form through useManufacturerCatalog) stays free of that side effect.
const defaultClient = async () => (await import("./catalogApiClient.js")).catalogApiClient;

// "Never throws" made true: a module that fails to load (a stale bundle after a deploy) is a failed call, not an exception.
const UNLOADABLE = Object.freeze({ ok: false, code: "UNREACHABLE", message: "the Catalog client could not be loaded" });
async function callCatalog(deps, operation, input) {
  try {
    const client = deps.client ?? (await defaultClient());
    return await (input === undefined ? client.call(operation) : client.call(operation, input));
  } catch {
    return UNLOADABLE;
  }
}

/**
 * The full Manufacturer list. Returns { result } in the envelope domain/manufacturerCatalogView.js reads
 * ({status:"ready", manufacturers, excludedCount, truncated}), or { errorStatus: "denied" | "unavailable" }.
 * Never throws. `truncated` is the server saying more rows exist than its bound (MANUFACTURER_LIST_MAX).
 */
export async function fetchManufacturerCatalog(deps = {}) {
  const res = await callCatalog(deps, "listManufacturers");
  if (!res.ok) return { errorStatus: res.code === "FORBIDDEN" ? "denied" : "unavailable" };
  const manufacturers = res.result?.manufacturers;
  if (!Array.isArray(manufacturers)) return { errorStatus: "unavailable" };
  return {
    result: {
      status: "ready",
      excludedCount: 0,
      truncated: res.result.truncated === true,
      // updatedAt is the writer's concurrency token; a rename or status change sends it back as expectedUpdatedAt.
      manufacturers: manufacturers.map((m) => ({ manufacturerId: m.id, name: m.name, status: m.status, updatedAt: m.updatedAt })),
    },
  };
}

const OUTCOME_BY_CODE = Object.freeze({
  FORBIDDEN: { kind: "denied", message: "You are not authorized to make this change." },
  NOT_SIGNED_IN: { kind: "denied", message: "You must be signed in." },
  INVALID_INPUT: { kind: "invalid", message: "Some fields are missing or invalid. Check the form and try again." },
  NOT_FOUND: { kind: "notFound", message: "That manufacturer no longer exists. Reload the list." },
  CONFLICT: { kind: "conflict", message: "This manufacturer changed since you loaded it, or that identifier is already in use. Reload and retry." },
  PRECONDITION_FAILED: { kind: "invalid", message: "That change isn't allowed for this manufacturer's current state." },
});

/** The Catalog API's answer as the outcome the page shows. Pure; exported for tests. Never invents a success. */
export function manufacturerWriteOutcome(res) {
  if (res?.ok) {
    return res.result?.replayed
      ? { kind: "replayed", message: "Already recorded (no change)." }
      : { kind: "applied", message: "Saved." };
  }
  return OUTCOME_BY_CODE[res?.code] ?? { kind: "error", message: "The request could not be completed. Try again." };
}

const command = async (operation, input, deps = {}) =>
  manufacturerWriteOutcome(await callCatalog(deps, operation, input));

export const manufacturerCommands = Object.freeze({
  create: ({ manufacturerId, name }, deps) =>
    command("createManufacturer", { manufacturer: { manufacturerId, name } }, deps),
  rename: ({ manufacturerId, expectedUpdatedAt, name }, deps) =>
    command("updateManufacturer", { manufacturerId, expectedUpdatedAt, name }, deps),
  changeStatus: ({ manufacturerId, expectedUpdatedAt, newStatus }, deps) =>
    command("changeManufacturerStatus", { manufacturerId, expectedUpdatedAt, newStatus }, deps),
});

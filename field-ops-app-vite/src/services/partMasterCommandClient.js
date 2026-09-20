// Part Master WRITES, through the GOVERNED RENDER CATALOG API.
//
//   browser -> services/catalogApiClient.js -> POST /operations/catalog -> PostgreSQL
//
// This used to invoke the three Firebase callables (createPart / updatePart / changePartStatus).
// Those remain EXPORTED and deployed -- they are legacy authority pending retirement, and removing
// an export is a deployment, not a code change -- but nothing in this application calls them any
// more. There is no fallback: a refused or failed command is returned as a value the screen renders.
//
// Server-derived identity, unchanged in principle and stronger in practice: the actor was
// `request.auth.uid` inside the callable and is now the EOS Principal the Catalog API resolves from
// the bearer token. Neither is ever part of a payload built here.
//
// ONE Part authority. This client invokes it; it does not reimplement it.
import { catalogApiClient } from "./catalogApiClient.js";

/** The governed Catalog operations, mirrored from the server so a typo fails here, not as a 404. */
export const PART_MASTER_OPERATIONS = Object.freeze({
  create: "createPart",
  update: "updatePart",
  changeStatus: "changePartStatus",
});

/**
 * Kept under its frozen name so existing callers and tests are unaffected by the move.
 *
 * The VALUES changed from Firebase callable names to Catalog operation names because they are now
 * operations rather than callables; the keys did not.
 */
export const PART_MASTER_CALLABLES = PART_MASTER_OPERATIONS;

const call = async (operation, input, deps = {}) => {
  const client = deps.client ?? catalogApiClient;
  const res = await client.call(operation, input);
  // The shape the domain mapper already expects: the result on success, and the governed refusal
  // itself on failure. Nothing is retried anywhere else.
  if (res.ok) return res.result;
  const err = new Error(res.message ?? "the Catalog command was refused");
  err.code = res.code;
  err.reason = res.reason ?? null;
  throw err;
};

// Each method sends ONLY the fields its operation reads. expectedVersion is supplied by the caller
// (usePartMasterWrite). idempotencyKey is accepted and ignored by the governed command, which is
// content-addressed: an identical resend is a replay by construction rather than by a key.
export const partMasterCommandClient = Object.freeze({
  createPart: ({ part }, deps) => call(PART_MASTER_OPERATIONS.create, { part }, deps),
  updatePart: ({ partId, expectedVersion, changes }, deps) =>
    call(PART_MASTER_OPERATIONS.update, { partId, expectedVersion, changes }, deps),
  changePartStatus: ({ partId, expectedVersion, newStatus }, deps) =>
    call(PART_MASTER_OPERATIONS.changeStatus, { partId, expectedVersion, newStatus }, deps),
});

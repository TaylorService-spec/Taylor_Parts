// Work Order physical consumption — THE ACTIVATION GATE.
//
// The authority: a source resolver, a governed movement, a correction that reverses to the original
// source, and an on-hand derivation that sees all of it.
//
// ============================ THE BLOCKER, AND HOW IT WAS CLOSED ============================
//
// This was false, and the reason was specific. The ruling resolution order ends in EXPLICIT
// SELECTION, and a technician could not make one: warehouses reads require admin/dispatcher or a
// warehouse assignment, mobile_locations requires admin/dispatcher, and this command requires
// role === "technician" exactly. The actor who must name the source could read neither the
// warehouses nor their own truck.
//
// Decision #171 closed that WITHOUT granting a standing read. listWorkOrderConsumptionSources is
// a trusted, command-scoped projection: it answers "for this technician, this Work Order, this
// part, what may the source be?" and returns location IDENTITIES ONLY -- no on-hand, no available,
// no reserved, no ATP. firestore.rules is unchanged, and a test asserts it.
//
// So the fallback is now reachable, and the gate opens:
//
//   serialized custody      decides automatically, no selection offered
//   unambiguous pick        pre-selected, and overridable
//   explicit selection      offered from the trusted projection, revalidated at submit
//   none of those           REFUSED, with wording the technician can act on
//
// THE GATE STAYS. It is not deleted now that it is true -- it is the one place "is physical
// consumption live?" is answered, and turning it off is how this is reverted without unpicking a
// transaction. A stale picker option is still not authority: the permitted set is re-derived at
// submit, so a warehouse deactivated between render and submit refuses rather than succeeds.
export const PHYSICAL_CONSUMPTION_ACTIVE = true;

/**
 * The blocker this gate WAS waiting on, kept as the name of what closed it (Decision #171).
 * Retained rather than removed so a future reader can find the question, not just the answer.
 */
export const PHYSICAL_CONSUMPTION_BLOCKER = "CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED";

// Work Order physical consumption — THE ACTIVATION GATE, and the honest reason it is closed.
//
// The authority is complete: a source resolver, a governed movement, a correction that reverses to
// the original source, and an on-hand derivation that sees all of it. What is NOT complete is the
// one thing the ruling's fallback depends on.
//
// ============================ THE BLOCKER, MEASURED ============================
//
// The ruling's resolution order is: serialized custody → picked placement → EXPLICIT SELECTION →
// refuse. The first two need no user input. The third does, and a technician cannot make it:
//
//   firestore.rules  warehouses      allow read: isAdminOrDispatcher() || isAssignedToWarehouse(id)
//   firestore.rules  mobile_locations allow read: isAdminOrDispatcher()
//
// `updateWorkOrderExecutionData` requires `caller.role === "technician"` EXACTLY — admin and
// dispatcher are rejected. So the actor who must name the source can read neither the warehouses nor
// their own truck. There is also no capability anywhere that says which inventory locations a
// technician may consume FROM; the resolver takes `governedLocations` as an input precisely so that
// absence is visible rather than assumed.
//
// ============================ WHY THAT MEANS OFF, NOT SHIPPED ============================
//
// Turning this on now would refuse every consumption that has no pick placement — and picking is
// optional, so that is a large share of real field work. It would trade an inventory overstatement
// for technicians unable to record what they did, with no action available to fix it. That is not a
// safer failure; it is a worse one, and it is not what the ruling intends by "refused".
//
// So the code path is complete, tested and INERT. Flipping this constant is a deliberate act that
// depends on ONE governed answer: which inventory locations may a technician consume from, and
// through what read. Until then the existing behaviour is unchanged — qtyUsed records as it always
// has, and physical on-hand stays overstated, which is the defect this package did not get to close.
//
// This is deliberately NOT a per-environment override or a wall-clock date. It is a single named
// boolean so that "is physical consumption live?" has exactly one answer, in one place, that reads
// the same to everyone.
export const PHYSICAL_CONSUMPTION_ACTIVE = false;

/**
 * The exact blocker, so a reader does not have to reconstruct it from Rules.
 *
 * Named rather than described: `CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED` is what has to be
 * ruled and wired, and it is a narrower question than the one this package answered.
 */
export const PHYSICAL_CONSUMPTION_BLOCKER = "CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED";

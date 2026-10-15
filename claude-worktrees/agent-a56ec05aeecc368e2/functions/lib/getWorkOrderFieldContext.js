"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkOrderFieldContext = void 0;
exports.authorizeFieldContextRead = authorizeFieldContextRead;
// F1 — Work Order Field Context: a NARROW trusted display projection for the
// technician field experience.
//
// WHY THIS EXISTS. A technician may read their OWN assigned Work Order
// (firestore.rules: `isTechnician() && isOwnTechnician(resource.data.assignedTechId)`),
// so they legitimately receive `customerId` and `locationId`. They may NOT read
// the referenced `accounts` / `locations` records — both are
// `allow read: if isAdminOrDispatcher()` — and the technician Role does not hold
// `account.record.read`. Field Mode therefore had no governed way to answer
// "who is the customer / which site am I going to?".
//
// The Owner-approved resolution (Option 1) is this: a trusted server projection,
// NOT a Rules widening, NOT a broad capability grant, and NOT a denormalised
// `customerName` on the Work Order. Canonical ownership is unchanged — Account
// remains authoritative for customer identity, Location for site identity, and
// the Work Order remains a reference/composition object carrying ids only.
//
// THE TRUST FLOW, and the property that makes this safe:
//
//   authenticated caller
//     -> resolve caller technician identity (server-side, getCallerContext)
//       -> read the Work Order
//         -> verify it is assigned to THIS technician
//           -> take customerId/locationId FROM THE WORK ORDER
//             -> trusted read of canonical Account/Location
//               -> return ONLY the approved display projection
//
// The request carries `workOrderId` ONLY. The client cannot supply a
// customerId or locationId, so there is no way to point this at an arbitrary
// record: every id it reads is one the governed Work Order already contained,
// on a Work Order the caller is already authorised to read. That is what keeps
// this a projection of the caller's own work rather than a customer-lookup API.
//
// Deliberately NOT built: getAccount / getLocation / readDocument /
// resolveAnyCustomer. This is a business-purpose surface, not a generic reader.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const collections_1 = require("./constants/collections");
const ACCOUNTS_COLLECTION = "accounts";
const LOCATIONS_COLLECTION = "locations";
/**
 * The ONLY fields this projection may emit. Anything not derivable from these
 * is out of scope by construction — commercial profile, payment terms, tax
 * status, sales/financial data, notes, contacts, sibling locations, reporting
 * metadata and permissions are never read into the response.
 */
function displayNameFrom(data) {
    const raw = data?.name;
    if (typeof raw !== "string")
        return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Site label: the location's own name, qualified by city/state when present.
 * Uses the canonical fields already established on `locations` — no new or
 * duplicate display field is invented.
 */
function siteLabelFrom(data) {
    const name = displayNameFrom(data);
    if (!name)
        return null;
    const city = typeof data?.city === "string" ? data.city.trim() : "";
    const state = typeof data?.state === "string" ? data.state.trim() : "";
    const place = [city, state].filter(Boolean).join(", ");
    return place ? `${name} — ${place}` : name;
}
/**
 * Pure authorization core, extracted so the rules below are unit-testable
 * without an emulator — the same posture as transitionEngine.ts.
 *
 * Throws the exact HttpsError the callable should surface. Returns the ids to
 * read ONLY when the caller is the assigned technician on that Work Order.
 */
function authorizeFieldContextRead(params) {
    const { authenticated, callerRole, callerTechnicianId, workOrderExists, assignedTechId } = params;
    if (!authenticated) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    // Technician-only by design. This surface exists for the field experience;
    // admin/dispatcher already read accounts/locations directly under Rules.
    if (callerRole !== "technician") {
        throw new https_1.HttpsError("permission-denied", "Only technicians may read field context.");
    }
    if (!callerTechnicianId) {
        throw new https_1.HttpsError("failed-precondition", "This account has no technicianId mapping yet.");
    }
    if (!workOrderExists) {
        throw new https_1.HttpsError("not-found", "No such work order.");
    }
    // The assignment boundary. An unassigned Work Order (no assignedTechId) is
    // denied for the same reason another technician's is: it is not this
    // caller's work.
    if (!assignedTechId || assignedTechId !== callerTechnicianId) {
        throw new https_1.HttpsError("permission-denied", "This work order is not assigned to you.");
    }
    return { customerId: null, locationId: null };
}
exports.getWorkOrderFieldContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const workOrderId = request.data?.workOrderId;
    if (typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    }
    // Identity is resolved SERVER-SIDE from the authenticated uid — never from
    // client-visible role state.
    const caller = request.auth ? await (0, callerContext_1.getCallerContext)(request.auth.uid) : null;
    const db = (0, firestore_1.getFirestore)();
    const woSnap = await db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
    const wo = woSnap.data();
    // Throws on every denial path before any canonical record is read.
    authorizeFieldContextRead({
        authenticated: !!request.auth,
        callerRole: caller?.role ?? null,
        callerTechnicianId: caller?.technicianId ?? null,
        workOrderExists: woSnap.exists,
        assignedTechId: wo?.assignedTechId ?? null,
    });
    // The ids come from the GOVERNED Work Order, never from the request.
    const customerId = typeof wo?.customerId === "string" ? wo.customerId : null;
    const locationId = typeof wo?.locationId === "string" ? wo.locationId : null;
    const [accountSnap, locationSnap] = await Promise.all([
        customerId ? db.collection(ACCOUNTS_COLLECTION).doc(customerId).get() : Promise.resolve(null),
        locationId ? db.collection(LOCATIONS_COLLECTION).doc(locationId).get() : Promise.resolve(null),
    ]);
    const displayName = accountSnap?.exists ? displayNameFrom(accountSnap.data()) : null;
    const displayLabel = locationSnap?.exists ? siteLabelFrom(locationSnap.data()) : null;
    const result = {
        workOrderId,
        customer: {
            // ABSENT (no reference) and UNRESOLVED (reference present, no usable
            // canonical value) are different facts and stay different. The raw id is
            // never emitted as a fallback display value.
            state: !customerId ? "ABSENT" : displayName ? "RESOLVED" : "UNRESOLVED",
            displayName,
        },
        site: {
            state: !locationId ? "ABSENT" : displayLabel ? "RESOLVED" : "UNRESOLVED",
            displayLabel,
        },
    };
    return result;
});
//# sourceMappingURL=getWorkOrderFieldContext.js.map
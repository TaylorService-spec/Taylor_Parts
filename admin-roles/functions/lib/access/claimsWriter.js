"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCompactClaims = setCompactClaims;
exports.revokeCompactClaims = revokeCompactClaims;
// Enterprise Access & Administration Platform (Issue #226) -- the
// compact-claims mint/refresh/revoke mechanics. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md
// sec11 and sequenced by docs/implementation-plans/enterprise-access-
// and-administration-platform.md (Row 6 / Task 11).
//
// Server-side ONLY -- not mirrored to field-ops-app-vite: clients never
// mint their own claims. NOT ACTIVATED IN PRODUCTION by this row
// (ADR-005 sec2.6/Spec sec17: "claims changes" are explicitly BLOCKED
// until Issue #15's trusted Cloud Functions are deployed and verified).
// This module builds and emulator-tests the mechanics; nothing calls
// it from a real request path yet -- it is intended to be called
// internally by Row 7's future trusted-writer commands (grantRole/
// revokeRole/setUserStatus/etc.), the same way auditEventWriter.ts is.
// Exporting it is not itself a deployment or activation action.
const auth_1 = require("firebase-admin/auth");
const compactClaims_1 = require("./compactClaims");
// Mints/refreshes a principal's compact claims. The caller (a future
// trusted-writer command) supplies the FULL authoritative claims
// payload for this access change -- this function never merges with
// whatever claims currently exist, so a stale field from a prior grant
// can never survive an update by omission (Spec sec11's four-field cap
// is enforced by buildCompactClaims on every call, not just the first).
async function setCompactClaims(uid, claims) {
    const validated = (0, compactClaims_1.buildCompactClaims)(claims);
    await (0, auth_1.getAuth)().setCustomUserClaims(uid, validated);
}
// Rollback path (Spec sec11/sec18 rollback invariant): clears every
// compact claim for a principal, returning them to the pre-claims,
// document-only resolution behavior this platform runs today. Setting
// custom claims to `null` (not `{}`) is what actually removes the
// claim namespace from a principal's token, per the Admin SDK contract.
async function revokeCompactClaims(uid) {
    await (0, auth_1.getAuth)().setCustomUserClaims(uid, null);
}
//# sourceMappingURL=claimsWriter.js.map
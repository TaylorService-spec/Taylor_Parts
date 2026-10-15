"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCallerContext = getCallerContext;
// Work Order Engine v1.2 -- resolves the calling user's role/technicianId
// server-side, via the same users/{uid} doc shape
// field-ops-app-vite/src/auth/AuthContext.jsx already reads client-side.
// Read here with Admin SDK privileges (bypasses firestore.rules, which is
// expected -- the Admin SDK always does).
const firestore_1 = require("firebase-admin/firestore");
async function getCallerContext(uid) {
    const snap = await (0, firestore_1.getFirestore)().collection("users").doc(uid).get();
    const data = snap.data();
    return {
        role: data?.role ?? null,
        technicianId: data?.technicianId ?? null,
    };
}
//# sourceMappingURL=callerContext.js.map
// Work Order Engine v1.2 -- resolves the calling user's role/technicianId
// server-side, via the same users/{uid} doc shape
// field-ops-app-vite/src/auth/AuthContext.jsx already reads client-side.
// Read here with Admin SDK privileges (bypasses firestore.rules, which is
// expected -- the Admin SDK always does).
import { getFirestore } from "firebase-admin/firestore";

export type Role = "admin" | "dispatcher" | "technician";

export interface CallerContext {
  role: Role | null;
  technicianId: string | null;
}

export async function getCallerContext(uid: string): Promise<CallerContext> {
  const snap = await getFirestore().collection("users").doc(uid).get();
  const data = snap.data();
  return {
    role: (data?.role as Role) ?? null,
    technicianId: (data?.technicianId as string) ?? null,
  };
}

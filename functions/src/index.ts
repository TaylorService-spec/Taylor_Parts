// Work Order Engine v1.2 -- Cloud Functions entry point.
// Deliberately thin: no logic here, so createWorkOrder.ts/
// transitionWorkOrder.ts stay independently testable.
import { initializeApp } from "firebase-admin/app";

initializeApp();

export { createWorkOrder } from "./createWorkOrder";
export { transitionWorkOrder } from "./transitionWorkOrder";

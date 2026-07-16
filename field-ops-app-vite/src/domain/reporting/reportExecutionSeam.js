// Issue #325 / ADR-007 W1 -- the client execution SEAM for the report builder.
//
// The builder renders and validates a definition entirely client-side (F1 catalog + F2
// validator), but a RUN requires the trusted, field-projecting Function (D-FN,
// runReportDefinitionCallable) that reads a governed collection with elevated privilege, projects
// to the runner's AUTHORIZED fields, and applies the predicate-drop rule (ADR-007 §2.4/§2.5). The
// client never reads a report collection directly -- this seam only invokes the Function and maps
// its outcome.
//
// UNAVAILABLE-SAFE: the client NEVER reads data itself and the seam NEVER throws. When the Function
// is not deployed (or otherwise unreachable) the callable rejects, and mapCallableError resolves it
// to the honest "unavailable" outcome (Spec §12) -- never a client-direct fallback, never a
// simulated result, never an optimistic success. All outcome/error mapping is the PURE, node-tested
// reportRunOutcome.js; this wrapper is deliberately thin so firebase stays out of the unit tests.
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/firebase";
import { mapServiceOutcome, mapCallableError } from "./reportRunOutcome.js";

// Re-export the pure helpers so existing importers keep working.
export {
  REPORT_RUN_UNAVAILABLE_REASON, reportRunUnavailable,
  reportRunPermissionDenied, reportRunUnsupported, reportRunFailure,
} from "./reportRunOutcome.js";

// D-FN's onCall export name (functions/src/index.ts), region us-central1 (firebase.js binds the
// functions instance to that region and, in ?emulator=1 dev, to the local Functions emulator).
const RUN_REPORT_CALLABLE = "runReportDefinitionCallable";

// The fixed run entry point. Validates nothing here (F2 already did on the builder); sends the
// definition to the trusted Function, which re-validates AND re-authorizes server-side. Returns a
// Promise of a mapped client outcome; resolves (never rejects) for every path.
export async function runReport(definition, options) {
  try {
    const callable = httpsCallable(functions, RUN_REPORT_CALLABLE);
    const result = await callable({ definition, ...(options?.definitionId ? { definitionId: options.definitionId } : {}) });
    return mapServiceOutcome(result?.data);
  } catch (err) {
    return mapCallableError(err);
  }
}

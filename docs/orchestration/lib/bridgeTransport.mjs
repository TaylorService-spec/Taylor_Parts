// Bridge transport — the ChatGPT-side API contract + an in-memory MOCK, and the honest
// register of what is NOT yet real (§3, §4, §14).
//
// SCOPE (Owner-ratified contracts-only): this defines the narrow collaboration API surface
// and a fully in-memory mock so the contracts + lifecycle + recovery behaviour can be proven
// WITHOUT any network, credential, or deployment. It does NOT procure a paid ChatGPT
// credential, deploy a Function, create a service identity, or perform any external call.
//
// SECURITY (§18A/§20): the API surface is deliberately NARROW — list/get/respond/ack over the
// bridge collection only. It NEVER exposes arbitrary Firestore access. A live implementation
// must enforce least-privilege per identity; the mock models the surface, not the auth.
//
// HONESTY (§3): a durable message that nobody is awakened to consume is NOT seamless
// collaboration. ACCESS != TRIGGER. This mock proves ACCESS semantics only; TRIGGER (waking
// ChatGPT, and waking Claude) is a FUTURE_SEAM below and is not simulated as if real.

import {
  createCollaborationRequest, advance, escalateOnSilence, isDuplicateDelivery, validateCollaborationRequest,
} from "./collaborationContract.mjs";

// The four operations a live bridge must expose. Names are the contract; the mock implements
// them in memory. A real transport (Function/Cloud Run behind Auth) would implement the same.
export const BRIDGE_API = Object.freeze(["listPendingRequests", "getRequest", "submitResponse", "acknowledgeResponse"]);

/**
 * In-memory mock transport. Deterministic; no clock (advance() and escalation take supplied
 * times). Use in tests and for the Claude-side consumption seam before any live bridge exists.
 */
export function createMockTransport() {
  const requests = new Map();   // requestId -> request
  const seenKeys = new Set();   // idempotency keys delivered
  const live = false;           // structural guard: a mock can NEVER report itself live

  return {
    isLive() { return live; },

    // Submit a NEW request into the bridge (from source to target). Idempotent: a duplicate
    // idempotencyKey returns the existing request rather than creating/acting twice.
    submitRequest(input) {
      const req = input.idempotencyKey ? input : createCollaborationRequest(input);
      const errs = validateCollaborationRequest(req);
      if (errs.length) throw new Error(`submitRequest: invalid — ${errs.join("; ")}`);
      if (isDuplicateDelivery(req, seenKeys)) {
        return { deduped: true, request: [...requests.values()].find((r) => r.idempotencyKey === req.idempotencyKey) };
      }
      const delivered = advance(req, "DELIVERED", { deliveryStatus: "DELIVERED" });
      requests.set(delivered.requestId, delivered);
      seenKeys.add(delivered.idempotencyKey);
      return { deduped: false, request: delivered };
    },

    // --- ChatGPT-side API (the responder polls/reads these) ---
    listPendingRequests(target) {
      return [...requests.values()].filter((r) => r.target === target && (r.status === "DELIVERED" || r.status === "ACKNOWLEDGED" || r.status === "IN_PROGRESS"));
    },
    getRequest(requestId) { return requests.get(requestId) || null; },

    acknowledgeResponse(requestId) {
      const r = requests.get(requestId);
      if (!r) throw new Error(`acknowledgeResponse: unknown ${requestId}`);
      const acked = advance(r, "ACKNOWLEDGED", { deliveryStatus: "ACKNOWLEDGED" });
      requests.set(requestId, acked);
      return acked;
    },

    submitResponse(requestId, response) {
      const r = requests.get(requestId);
      if (!r) throw new Error(`submitResponse: unknown ${requestId}`);
      const from = r.status === "REQUESTED" || r.status === "DELIVERED" ? advance(r, "ACKNOWLEDGED") : r;
      const responded = advance(from, "RESPONDED", { reviewVerdict: response.reviewVerdict ?? null, response });
      requests.set(requestId, responded);
      return responded;
    },

    // --- Claude-side consumption seam: responses the requester has not yet consumed ---
    // Mirrors the §23 result-consumption discipline: a RESPONDED request the source has not
    // consumed is actionable continuation work, not a finished item.
    pendingConsumption(source) {
      return [...requests.values()].filter((r) => r.source === source && r.status === "RESPONDED");
    },
    consume(requestId) {
      const r = requests.get(requestId);
      if (!r) throw new Error(`consume: unknown ${requestId}`);
      const consumed = advance(r, "CONSUMED");
      requests.set(requestId, consumed);
      return consumed;
    },

    // Recovery: re-derive escalations from persisted state (cold-start safe).
    escalateOverdue(nowMs) {
      const out = [];
      for (const [id, r] of requests) {
        const e = escalateOnSilence(r, nowMs);
        if (e !== r) { requests.set(id, e); out.push(e); }
      }
      return out;
    },

    _all() { return [...requests.values()]; },
  };
}

// ---------------------------------------------------------------------------------------
// FUTURE_SEAM register (§3, §4, §14). Explicit, honest list of capabilities that DO NOT yet
// exist end-to-end. Represented as data so the Control Center can project them truthfully and
// so nothing in the codebase can quietly claim they are real.
// ---------------------------------------------------------------------------------------
export const FUTURE_SEAMS = Object.freeze([
  { id: "claude-autonomous-wake", capability: "Claude wakes on an external event (no session open)", blockedBy: ["persistent Claude runtime"], class: "FUTURE_SEAM" },
  { id: "chatgpt-access", capability: "ChatGPT durably lists/reads/answers bridge requests", blockedBy: ["deployed narrow API", "auth"], class: "FUTURE_SEAM" },
  { id: "chatgpt-trigger", capability: "A new request triggers ChatGPT without manual checking", blockedBy: ["external scheduled compute", "ChatGPT API credential"], class: "FUTURE_SEAM" },
  { id: "claude-receipt-continuation", capability: "A ChatGPT response becomes actionable Claude work with no Owner relay", blockedBy: ["claude-autonomous-wake"], class: "FUTURE_SEAM" },
  { id: "deployed-bridge", capability: "Live transport (Function/Cloud Run) behind Auth", blockedBy: ["operator deploy"], class: "FUTURE_SEAM" },
  { id: "paid-chatgpt-credential", capability: "Paid ChatGPT API credential + custody", blockedBy: ["Owner paid-service commitment"], class: "FUTURE_SEAM" },
  { id: "service-identities", capability: "Least-privilege publisher/bridge/notification identities", blockedBy: ["operator IAM"], class: "FUTURE_SEAM" },
  { id: "trusted-notification-sender", capability: "Server-side notifications independent of the Owner browser", blockedBy: ["deployed sender", "email provider"], class: "FUTURE_SEAM" },
]);

// §14 — PC-INDEPENDENT EXECUTION dependence classification. Recorded, NOT built. Each current
// execution dependency is tagged so a future "run without the Owner PC" objective is scoped
// honestly rather than assumed.
export const PC_DEPENDENCE = Object.freeze([
  { dependency: "Claude session / harness (/loop + ScheduleWakeup)", requires: "Owner PC + running session", portable: false, note: "no cloud Claude runner exists" },
  { dependency: "Local git worktrees + CI-via-push", requires: "network only", portable: true, note: "CI already runs server-side on push" },
  { dependency: "Firebase publish (Admin SDK)", requires: "credential", portable: true, note: "operator/scheduled job could run it off-PC" },
  { dependency: "Browser/emulator verification", requires: "browser capability", portable: false, note: "needs a real browser/emulator runtime" },
  { dependency: "Netwatch telemetry", requires: "Owner PC + local network", portable: false, note: "machine-local by design" },
  { dependency: "ChatGPT collaboration", requires: "paid credential + deployed bridge", portable: false, note: "does not exist yet" },
]);

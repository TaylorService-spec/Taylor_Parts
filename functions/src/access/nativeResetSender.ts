// AUTH PRE-1 (G-PRE1-IMPL) -- concrete Firebase-native reset sender + durable,
// sender-owned idempotency-key deduplication, behind dependency injection.
//
// The actual Firebase-native send (later: a Function -> Auth REST
// `accounts:sendOobCode` call) is provided as an INJECTED `outbound` dependency.
// This module never makes a production call itself: with `outbound: null` the
// sender is fail-closed (`isConfigured() === false`), which is the deployed
// posture until an Owner-authorized AUTH-PROD gate wires a real outbound + a
// Secret Manager credential. Tests inject a controlled fake outbound.
//
// Dedupe guarantee: AT MOST ONE outbound call per `idempotencyKey` (D-PRE1).
// A crash between the outbound accept and the terminal write leaves the record
// `claimed`; a later call resolves that to `uncertain` (fail closed -- never a
// silent duplicate, never a false `accepted`). See the PRE-1 package.
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { NativeResetSender, NativeSendOutcome } from "./adminCredentialCommands";

const DEDUPE_COLLECTION = "admin_credential_reset_send_dedupe";

// The raw outbound native send. Returns { accepted: true } iff Firebase accepted
// the request (HTTP 200). Provider body / OOB code / link stay inside the
// implementation and are never returned. Supplied only by a later Owner-authorized
// gate or a test fake -- never wired to production in this repository change.
export type OutboundNativeSend = (args: {
  targetUid: string;
  email: string;
  idempotencyKey: string;
}) => Promise<{ accepted: boolean }>;

const DEDUPE_STATES = ["claimed", "accepted", "failed", "uncertain"] as const;
type DedupeState = (typeof DEDUPE_STATES)[number];
interface DedupeRecord {
  binding: string;
  state: DedupeState;
  claimedAtMs: number;
  updatedAtMs: number;
}

// Strict validation -- a malformed dedupe record fails closed (never treated as a
// terminal that could authorize a resend or suppress one incorrectly).
function isValidDedupeRecord(d: unknown): d is DedupeRecord {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const r = d as Record<string, unknown>;
  if (typeof r.binding !== "string" || r.binding.length === 0) return false;
  if (typeof r.state !== "string" || !(DEDUPE_STATES as readonly string[]).includes(r.state)) return false;
  if (typeof r.claimedAtMs !== "number" || !Number.isFinite(r.claimedAtMs)) return false;
  if (typeof r.updatedAtMs !== "number" || !Number.isFinite(r.updatedAtMs)) return false;
  return true;
}

// Raised when a key is reused with a different command binding (fail closed).
export class SendBindingMismatchError extends Error {}
// Raised when the persisted dedupe record is malformed (fail closed).
export class MalformedSendDedupeError extends Error {}

export function createNativeResetSender(deps: { outbound: OutboundNativeSend | null }): NativeResetSender {
  const ref = (key: string) => getFirestore().collection(DEDUPE_COLLECTION).doc(key);

  return {
    // Attests that it can send natively AND deduplicates on idempotencyKey. With no
    // wired outbound this is false -> the command fails closed (no send).
    isConfigured(): boolean {
      return deps.outbound !== null;
    },

    async sendReset({ targetUid, email, idempotencyKey, binding }): Promise<{ outcome: NativeSendOutcome }> {
      const outbound = deps.outbound;
      if (outbound === null) return { outcome: "not_accepted" };

      // Phase 1 (transaction): claim a fresh key, or resolve a replay/uncertain
      // terminal for an existing one. A re-encountered `claimed` record (a crash
      // left it in flight) resolves to `uncertain` and is recorded as such.
      type Directive =
        | { do: "send" }
        | { do: "replay"; outcome: NativeSendOutcome }
        | { do: "uncertain" };
      const directive = await getFirestore().runTransaction<Directive>(async (tx) => {
        const snap = await tx.get(ref(idempotencyKey));
        const now = Date.now();
        if (snap.exists) {
          const raw = snap.data();
          if (!isValidDedupeRecord(raw)) {
            throw new MalformedSendDedupeError("send-dedupe record is malformed");
          }
          if (raw.binding !== binding) {
            throw new SendBindingMismatchError("idempotency key reused with a different binding");
          }
          if (raw.state === "accepted") return { do: "replay", outcome: "accepted" };
          if (raw.state === "failed") return { do: "replay", outcome: "not_accepted" };
          if (raw.state === "uncertain") return { do: "replay", outcome: "uncertain" };
          // state === "claimed" re-encountered: possibly-sent, outcome unknown ->
          // fail closed to uncertain; never call the outbound again.
          tx.update(ref(idempotencyKey), { state: "uncertain", updatedAtMs: now });
          return { do: "uncertain" };
        }
        tx.set(ref(idempotencyKey), {
          binding,
          state: "claimed",
          claimedAtMs: now,
          updatedAtMs: now,
          at: FieldValue.serverTimestamp(),
        });
        return { do: "send" };
      });

      if (directive.do === "replay") return { outcome: directive.outcome };
      if (directive.do === "uncertain") return { outcome: "uncertain" };

      // Phase 2: the outbound native send, OUTSIDE the transaction. If it throws
      // (or the process crashes) before the phase-3 terminal write, the record
      // stays `claimed` -> a later call resolves to `uncertain` (no duplicate).
      const res = await outbound({ targetUid, email, idempotencyKey });
      const accepted = res.accepted === true;

      // Phase 3 (transaction): record the terminal outcome iff still `claimed` for
      // this binding (a stale/superseded state is never overwritten).
      await getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref(idempotencyKey));
        if (!snap.exists) return;
        const raw = snap.data();
        if (!isValidDedupeRecord(raw) || raw.binding !== binding || raw.state !== "claimed") return;
        tx.update(ref(idempotencyKey), { state: accepted ? "accepted" : "failed", updatedAtMs: Date.now() });
      });

      return { outcome: accepted ? "accepted" : "not_accepted" };
    },
  };
}

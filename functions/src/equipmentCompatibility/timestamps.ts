// D4 governed Timestamp contract -- the SINGLE interpretation of a persisted Firestore Timestamp,
// shared by the operation state machine and the repository audit envelope. Extracted so no second
// consumer can reintroduce a millisecond-truncating or laxly-validated variant.
import { Timestamp } from "firebase-admin/firestore";

export interface TimestampParts {
  seconds: number;
  nanoseconds: number;
}

// Firestore's actual Timestamp domain: 0001-01-01T00:00:00Z through 9999-12-31T23:59:59.999999999Z.
// A safe-integer seconds value outside this range is NOT a representable Firestore Timestamp, so
// accepting it would let an unstorable value pass validation. Both endpoints are inclusive.
export const TIMESTAMP_MIN_SECONDS = -62135596800;
export const TIMESTAMP_MAX_SECONDS = 253402300799;

// STRICTLY VALIDATED Firestore Timestamp REPRESENTATION. This is deliberately not called an
// authenticity or provenance proof: an object carrying Timestamp.prototype and genuine backing fields is
// indistinguishable from one the SDK constructed, and we do not claim otherwise. What it does guarantee
// is that the value has the exact shape the Admin SDK produces for a snapshot field, with in-range
// integer components:
//   1. prototype is exactly Timestamp.prototype — rejects duck-types ({ toMillis: () => 1000 }) and
//      subclasses, which could override behaviour;
//   2. own property names are EXACTLY the SDK's two backing fields, _seconds and _nanoseconds. This is
//      what rejects an Object.create(Timestamp.prototype) forgery with injected PUBLIC seconds /
//      nanoseconds: on a real Timestamp those are PROTOTYPE GETTERS and are never own properties;
//   3. the public getters agree with the backing fields, so shadowing or redefinition diverges;
//   4. components are safe integers, seconds within Firestore's representable range
//      [TIMESTAMP_MIN_SECONDS, TIMESTAMP_MAX_SECONDS] and nanoseconds in [0, 999999999].
// toMillis() is never called, so a stateful impostor cannot return a finite value on one read and NaN on
// the next. Property access is guarded because a hostile object can define throwing getters; the reader
// returns null (→ invalid) instead of throwing, keeping timestamp validation total and fail-closed.
export function readTimestamp(v: any): TimestampParts | null {
  if (v === null || typeof v !== "object") return null;
  let seconds: any, nanoseconds: any, publicSeconds: any, publicNanoseconds: any;
  // EVERY reflective and property operation is inside the guard, including getPrototypeOf: a Proxy can
  // install a throwing getPrototypeOf / getOwnPropertyNames trap, and readTimestamp is exported, so it
  // must be total on its own rather than relying on a caller's wrapper.
  try {
    if (Object.getPrototypeOf(v) !== Timestamp.prototype) return null;
    const own = Object.getOwnPropertyNames(v);
    if (own.length !== 2 || !own.includes("_seconds") || !own.includes("_nanoseconds")) return null;
    if (Object.getOwnPropertySymbols(v).length !== 0) return null;
    seconds = (v as any)._seconds;
    nanoseconds = (v as any)._nanoseconds;
    publicSeconds = (v as any).seconds;
    publicNanoseconds = (v as any).nanoseconds;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(seconds) || seconds < TIMESTAMP_MIN_SECONDS || seconds > TIMESTAMP_MAX_SECONDS) return null;
  if (!Number.isSafeInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999_999_999) return null;
  if (publicSeconds !== seconds || publicNanoseconds !== nanoseconds) return null;
  return { seconds, nanoseconds };
}

// EXACT ordering on the (seconds, nanoseconds) tuple. Millisecond conversion is never used for ordering
// or equality: seconds*1000 + floor(ns/1e6) collapses sub-millisecond differences, so a terminalAt one
// nanosecond BEFORE initiatedAt would compare equal and validate.
export function compareTimestamps(a: TimestampParts, b: TimestampParts): number {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  if (a.nanoseconds !== b.nanoseconds) return a.nanoseconds < b.nanoseconds ? -1 : 1;
  return 0;
}

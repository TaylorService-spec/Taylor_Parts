// A STRUCTURAL TIMESTAMP TYPE, with no Firebase import (Firebase exit PR-C, 2026-10-15).
//
// Record types that describe stored documents used `import type { Timestamp }` from the Firestore SDK only to name a
// field's type. That type-only import still counted as a Firestore dependency of the file. This interface states the
// members the code actually reads; a real Firestore Timestamp satisfies it structurally, so values flow in unchanged.
//
// A declaration file on purpose: it emits nothing, so the compiled JavaScript is byte-identical with or without it.
export interface TimestampShape {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

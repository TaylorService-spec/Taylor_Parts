// THE ACCOUNTABILITY STORE — a real implementation of the S4 seam, over one document port.
//
// ════════════════════ WHY THIS EXISTS, AND WHAT CHANGED ════════════════════
//
// Wave 2B shipped `AccountabilityStore` (`governedResponsibilityHandoff.ts`) as a SEAM with no
// implementation, and said so honestly: "There is no accountability storage in this repository." Wave
// 2C's migration 1759276800000 created it — `accountable_employee_id` on the three admitted families
// — and `accountablePersonStorage.ts` declares its document-side shape. This module is the adapter
// between them, and it is what makes the accountability write path REAL rather than hypothetical.
//
// ════════════════════ WHY IT TAKES A DOCUMENT PORT AND NOT A DATABASE CLIENT ════════════════════
//
// The same reason `governedResponsibilityHandoff.ts` takes `OwnershipRecordPort` rather than a
// Firestore transaction: the commercial three are written today through the Firestore document path
// and tomorrow through `eos_commercial`, and #185 requires the port in front of the Employee
// authority to "hide storage from governed business commands... without changing `OD-7` orchestration
// semantics". The same requirement holds for the record being changed. So this module knows the FIELD
// NAMES and the FAMILY SCOPE — which are governed facts — and knows nothing about the driver.
//
// It therefore imports no `firebase-admin`, no `pg`, no clock and no `node:` module, exactly like the
// boundary it plugs into, and the ATOMIC UNIT stays the caller's: `stageFieldWrite` stages, it does not
// commit. #184: "On any failure: ZERO HANDOFF MUTATION · ZERO PARTIAL AUDIT · ZERO RESPONSIBILITY GAP."
// A store that committed by itself could not honour that, because the audit is staged after it.
//
// ════════════════════ THE SCOPE CHECK IS HERE TOO, AND THAT IS NOT DUPLICATION ════════════════════
//
// The governed boundary already refuses `FAMILY_NOT_ACCOUNTABLE` before it reaches a store. This store
// refuses again, and the reason is that the two refusals protect different things: the boundary's
// protects the COMMAND, and this one protects the STORAGE. #189 `OD-16` says an out-of-scope family's
// accountability is NOT APPLICABLE and that "reference and master-data objects must not acquire fake
// personal accountability" — a store that would happily write `accountableEmployeeId` onto a
// `suppliers` document if asked is a store through which that could happen. It cannot be asked here.

import {
  ACCOUNTABLE_PERSON_FIELD,
  accountablePersonFields,
  accountablePersonStorage,
  readStoredAccountablePerson,
  type EstablishedAccountablePerson,
} from "./accountablePersonStorage";
import type {
  AccountabilityStore,
  AccountablePersonRead,
  AuthoritativeRecordRead,
  ResponsibilityTarget,
} from "./governedResponsibilityHandoff";

/**
 * The one thing this store needs of storage: read a record's fields, stage a field write.
 *
 * `readFields` reuses `AuthoritativeRecordRead` — the SAME three-outcome read the ownership axis uses,
 * including its fail-closed `READ_UNAVAILABLE`. Reusing it is deliberate: one read contract means one
 * place where "could not answer" is distinguished from "not there", which is #187 §2's requirement and
 * the thing two near-identical read types would eventually disagree about.
 */
export interface AccountabilityDocumentPort {
  readFields(target: ResponsibilityTarget): Promise<AuthoritativeRecordRead>;
  /**
   * Stage a field write onto the caller's atomic unit. MUST NOT COMMIT.
   *
   * Takes a FIELD MAP rather than an id, because the map is what `accountablePersonFields` produces
   * from a governed establishment — id and recorded source together. A port that took a bare id would
   * have to decide the source itself, and the source is a governed fact (#181), not a storage detail.
   */
  stageFieldWrite(target: ResponsibilityTarget, fields: Readonly<Record<string, string>>): void;
}

/** Raised when this store is asked to act on a family that carries no governed accountability. */
export class AccountabilityStorageScopeError extends Error {
  readonly code = "FAMILY_NOT_ACCOUNTABLE";
  constructor(family: unknown) {
    super(
      `${String(family)} has no governed accountability storage. #189 OD-16 admits exactly ` +
        "OPPORTUNITY, SALES AGREEMENT and SALES ORDER; for every other family accountability is NOT " +
        "APPLICABLE — not MISSING, not OWNERLESS, not DEFECTIVE — and writing an accountable person " +
        "onto one would be the fake personal accountability the ruling forbids.",
    );
    this.name = "AccountabilityStorageScopeError";
  }
}

/**
 * Build the store. One argument, and it is the only thing that touches storage.
 *
 * The returned object is exactly the `AccountabilityStore` the governed boundary expects, so the
 * boundary needs no knowledge of this module and no change to accept it.
 */
export function createRecordAccountabilityStore(
  documents: AccountabilityDocumentPort,
): AccountabilityStore {
  const requireScope = (target: ResponsibilityTarget): void => {
    if (accountablePersonStorage(target?.family) === null) {
      throw new AccountabilityStorageScopeError(target?.family);
    }
  };

  return {
    async readCurrentAccountablePerson(target: ResponsibilityTarget): Promise<AccountablePersonRead> {
      requireScope(target);
      const read = await documents.readFields(target);
      if (read.outcome === "RECORD_NOT_FOUND") return { outcome: "RECORD_NOT_FOUND" };
      if (read.outcome === "READ_UNAVAILABLE") {
        // Passed through UNCHANGED. #187 §2: an unobtainable answer is not an absent accountable
        // person, and this is the one line where converting it would be easiest and worst.
        return { outcome: "READ_UNAVAILABLE", detail: read.detail };
      }
      const stored = readStoredAccountablePerson(read.fields);
      switch (stored.state) {
        case "PRESENT":
          return { outcome: "READ", accountableEmployeeId: stored.accountableEmployeeId };
        case "ABSENT":
          // An HONEST null: the field is genuinely not set. There is deliberately no fallback to
          // `ownerEmployeeId` here — #181 forbids the permanent computed identity, and a read-side
          // fallback would install it more quietly than a write-side one.
          return { outcome: "READ", accountableEmployeeId: null };
        case "UNREADABLE":
        default:
          return {
            outcome: "CURRENT_UNREADABLE",
            detail: stored.detail ?? `stored ${ACCOUNTABLE_PERSON_FIELD} is not a usable Employee id`,
          };
      }
    },

    stageAccountablePersonWrite(
      target: ResponsibilityTarget,
      established: EstablishedAccountablePerson,
    ): void {
      requireScope(target);
      // `accountablePersonFields` re-checks the governed mark and throws if it is absent, so a forged
      // value cannot reach storage even if a future caller bypassed the type system.
      documents.stageFieldWrite(target, accountablePersonFields(established));
    },
  };
}

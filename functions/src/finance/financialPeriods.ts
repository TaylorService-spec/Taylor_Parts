// Finance — PURE period & close core (F9 / FIN-008). EOS is a governed OPERATIONAL financial subledger
// (DECISIONS #145) — so "close" here is the OPERATIONAL reporting close: an explicit, per-company
// declaration that a date window's operational financial facts are complete for reporting. It is NOT an
// accounting close (the external authority of record — not yet selected — owns that).
//
// Fixed machinery (policy-free):
//   • A period is an explicit record: company + inclusive ISO window + OPEN|CLOSED. Closing is an
//     explicit governed act (closer + reason + ctx time). REOPEN is deliberately NOT modeled — a closed
//     period cannot be quietly reopened; if the Owner ever wants reopening it is its own decision.
//   • A CLOSED period REFUSES new financial events dated inside it (assertEventDateOpen) — late facts
//     must be handled by an explicit governed mechanism (FIN-007 approval / adjustment in an open
//     period), never slipped into closed history (invariants B/C).
//   • A close regime governs ONLY what it declares: an event date covered by NO declared period is
//     ALLOWED — closing is an explicit act, and the absence of a period record cannot retroactively
//     close anything. Overlapping periods for one company are a thrown configuration defect.
// Cadence (monthly/quarterly), who may close, and late-event policy are Owner decisions (policy values).
// Pure; no I/O; storage and activation stay F12/F14.

export const PERIOD_STATUSES = Object.freeze(["OPEN", "CLOSED"] as const);
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export class PeriodError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "PeriodError"; this.code = code; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface FinancialPeriodInput {
  operatingCompanyId: string; // periods are per company — Taylor's close is not Ventana's
  periodStart: string; // YYYY-MM-DD inclusive
  periodEnd: string; // YYYY-MM-DD inclusive
  status: string;
  /** Required iff CLOSED — a close is an explicit governed act. */
  closedByUid?: string | null;
  closeReason?: string | null;
  closedAtMillis?: number | null;
}

export interface FinancialPeriod {
  operatingCompanyId: string;
  periodStart: string;
  periodEnd: string;
  status: PeriodStatus;
  closedByUid: string | null;
  closeReason: string | null;
  closedAtMillis: number | null;
}

// Validate + freeze one period record. A CLOSED period must carry its close facts; an OPEN one must not.
export function buildFinancialPeriod(input: FinancialPeriodInput): FinancialPeriod {
  if (!nonEmpty(input?.operatingCompanyId)) throw new PeriodError("COMPANY_REQUIRED", "a period belongs to one operating company");
  if (!ISO_DATE.test(input.periodStart ?? "") || !ISO_DATE.test(input.periodEnd ?? "")) throw new PeriodError("PERIOD_INVALID", "periodStart/periodEnd must be ISO dates (YYYY-MM-DD)");
  if (input.periodEnd < input.periodStart) throw new PeriodError("PERIOD_INVALID", "periodEnd precedes periodStart");
  if (!(PERIOD_STATUSES as readonly string[]).includes(input.status)) throw new PeriodError("STATUS_INVALID", `status must be one of ${PERIOD_STATUSES.join("/")}`);
  if (input.status === "CLOSED") {
    if (!nonEmpty(input.closedByUid)) throw new PeriodError("CLOSE_FACTS_REQUIRED", "a CLOSED period names who closed it");
    if (!nonEmpty(input.closeReason)) throw new PeriodError("CLOSE_FACTS_REQUIRED", "a CLOSED period carries the close reason");
    if (!isInt(input.closedAtMillis) || (input.closedAtMillis as number) <= 0) throw new PeriodError("CLOSE_FACTS_REQUIRED", "a CLOSED period carries closedAtMillis (ctx-supplied)");
  } else if (input.closedByUid || input.closeReason || input.closedAtMillis) {
    throw new PeriodError("CLOSE_FACTS_FORBIDDEN", "an OPEN period must not carry close facts");
  }
  return Object.freeze({
    operatingCompanyId: input.operatingCompanyId.trim(),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: input.status as PeriodStatus,
    closedByUid: input.status === "CLOSED" ? (input.closedByUid as string).trim() : null,
    closeReason: input.status === "CLOSED" ? (input.closeReason as string).trim() : null,
    closedAtMillis: input.status === "CLOSED" ? (input.closedAtMillis as number) : null,
  });
}

const overlaps = (a: FinancialPeriod, b: FinancialPeriod): boolean =>
  a.operatingCompanyId === b.operatingCompanyId && a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;

// Guard a new financial event's date against a company's declared periods. Refuses when the date falls in
// a CLOSED period of THAT company; allows an uncovered date (a close regime governs only what it
// declares); throws on overlapping declared periods (ambiguous configuration is a defect, not a rule).
export function assertEventDateOpen(
  periods: FinancialPeriod[],
  event: { operatingCompanyId: string; eventDate: string; label: string },
): void {
  if (!nonEmpty(event?.operatingCompanyId)) throw new PeriodError("COMPANY_REQUIRED", "the event names its operating company");
  if (!ISO_DATE.test(event.eventDate ?? "")) throw new PeriodError("EVENT_DATE_INVALID", "eventDate must be an ISO date (YYYY-MM-DD)");
  const list = (Array.isArray(periods) ? periods : []).filter((p) => p?.operatingCompanyId === event.operatingCompanyId);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (overlaps(list[i], list[j])) {
        throw new PeriodError("PERIODS_OVERLAP", `periods ${list[i].periodStart}..${list[i].periodEnd} and ${list[j].periodStart}..${list[j].periodEnd} overlap for ${event.operatingCompanyId} — ambiguous period configuration is a defect`);
      }
    }
  }
  const hit = list.find((p) => event.eventDate >= p.periodStart && event.eventDate <= p.periodEnd);
  if (hit && hit.status === "CLOSED") {
    throw new PeriodError(
      "PERIOD_CLOSED",
      `${event.label} dated ${event.eventDate} falls in the CLOSED period ${hit.periodStart}..${hit.periodEnd} (${event.operatingCompanyId}) — closed history is not writable; use the governed late-event path`,
    );
  }
}

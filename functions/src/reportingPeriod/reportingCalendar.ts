// REPORTING CALENDAR -- the governed answer to "in what timezone, and starting which month, does
// this operating company's reporting year run".
//
// G-05, Owner ruling 2026-09-02. This is CONFIGURATION, not arithmetic: it says WHICH calendar
// applies, and `reportingPeriod.ts` does the resolving. Splitting them is what lets a future
// operating company use a different reporting calendar without a metric being rewritten -- the
// metric asks for MTD, the calendar says what a month is.
//
// ============================ WHAT WAS ALREADY HERE, AND WHAT WAS NOT ============================
//
// NOTHING in this repository asserted a reporting calendar before this file. Measured, not assumed:
//   * `finance/financialPeriods.ts` (FIN-008) is a CLOSE authority -- per-company OPEN/CLOSED
//     windows someone declares. Its own header says cadence "and late-event policy are Owner
//     decisions", and it carries no year-start, no quarter structure and no timezone field. It
//     refuses a late write into a declared closed window; it invents no calendar.
//   * The only IANA timezone authority is `scheduling/` -- a PER-TECHNICIAN `timeZone` on a working
//     schedule. Not a platform reporting zone.
//   * `America/Phoenix` appeared in the repository exactly once, as an example string in a doc
//     comment.
//
// So this file CONTRADICTS nothing. That mattered enough to check: had a fiscal year other than
// January existed anywhere, this ruling would have been an authority conflict rather than a gap
// being filled, and the correct action would have been to report it rather than overwrite it.
//
// ============================ WHY IT LIVES ON THE OPERATING COMPANY ============================
//
// A reporting calendar is a property of the company doing the reporting, and
// `ownership/operatingCompanyAuthority.ts` is already the governed per-company registry. Extending
// it is smaller than a new collection, a new config file, or a new tenant subsystem -- none of which
// this authority needs, and all of which would have to be maintained forever.
//
// ============================ CHANGING ONE IS PROSPECTIVE ============================
//
// A reporting calendar is business authority. Changing a timezone or a year start must NOT
// retroactively redefine what last year's reports meant. This file therefore declares the CURRENT
// calendar and nothing else: it has no history, and it must not grow one by mutation. When a company
// genuinely changes its calendar, the governed precedent to follow is the one this repository
// already uses for effective-dated authority -- `performance/performanceGoal.ts`'s
// effectiveFrom/effectiveTo + version + transactional supersession, where a changed value is a NEW
// version beside the old one rather than an edit to it.
//
// That precedent is NAMED rather than built, deliberately. Building an effective-dated calendar
// subsystem for a value that has never changed, for two companies that share one calendar, would be
// speculative architecture. The seam is recorded so the day it changes is a known piece of work.
//
// PURE. No Firestore, no clock, no Intl -- this file only says which calendar applies.
import { OPERATING_COMPANY_IDS, type OperatingCompanyId } from "../ownership/operatingCompanyAuthority";

/**
 * A reporting calendar.
 *
 * `reportingYearStartMonth` is 1-12 (1 = January). Quarters are the three-month blocks measured
 * FROM that start month, so a January start yields Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec, and a
 * July start would yield Jul-Sep / Oct-Dec / Jan-Mar / Apr-Jun without any metric changing.
 */
export interface ReportingCalendar {
  readonly reportingTimeZone: string;
  readonly reportingYearStartMonth: number;
}

/**
 * The Taylor / Ventana reporting basis. Owner ruling, G-05.
 *
 * BOTH companies share it, which is what makes a consolidated period-relative figure legitimate at
 * all (see `resolveSharedReportingCalendar`). Phoenix does not observe daylight saving, so this
 * particular zone is a fixed -07:00 all year -- which is a convenience, NOT an assumption this code
 * is allowed to make. The resolver uses IANA-correct conversion regardless, because the next
 * operating company may well be somewhere that does.
 */
export const TAYLOR_VENTANA_REPORTING_CALENDAR: ReportingCalendar = Object.freeze({
  reportingTimeZone: "America/Phoenix",
  reportingYearStartMonth: 1,
});

/** Per-company calendars. Absence is not a default -- an unknown company resolves UNKNOWN. */
const CALENDARS: Readonly<Record<string, ReportingCalendar>> = Object.freeze({
  [OPERATING_COMPANY_IDS.TAYLOR]: TAYLOR_VENTANA_REPORTING_CALENDAR,
  [OPERATING_COMPANY_IDS.VENTANA]: TAYLOR_VENTANA_REPORTING_CALENDAR,
});

export type ReportingCalendarResolutionState = "RESOLVED" | "UNKNOWN_COMPANY" | "INCOMPATIBLE";

export interface ReportingCalendarResolution {
  readonly state: ReportingCalendarResolutionState;
  readonly calendar: ReportingCalendar | null;
  /** Present on a refusal. Safe to surface: it names what is missing, never what exists elsewhere. */
  readonly reason: string | null;
}

const resolved = (calendar: ReportingCalendar): ReportingCalendarResolution =>
  Object.freeze({ state: "RESOLVED" as const, calendar, reason: null });
const refused = (state: ReportingCalendarResolutionState, reason: string): ReportingCalendarResolution =>
  Object.freeze({ state, calendar: null, reason });

/** One company's calendar. An unknown id resolves UNKNOWN_COMPANY -- never a default calendar. */
export function resolveReportingCalendar(companyId: unknown): ReportingCalendarResolution {
  if (typeof companyId !== "string" || companyId.length === 0) {
    return refused("UNKNOWN_COMPANY", "a reporting calendar requires an operating company id");
  }
  const calendar = CALENDARS[companyId];
  if (!calendar) {
    return refused("UNKNOWN_COMPANY", `no reporting calendar is declared for operating company "${companyId}"`);
  }
  return resolved(calendar);
}

/**
 * The calendar for a MULTI-COMPANY reporting scope -- G-05 §16.
 *
 * A period-relative figure spanning two companies is only meaningful if both companies agree on
 * what the period IS. Two companies whose reporting years start in different months would produce a
 * "Q3" that covers different months for each, and summing those is not a consolidated figure, it is
 * two different questions added together.
 *
 * So this REFUSES rather than picking one, and refusing is the whole point: the failure it prevents
 * is silent, and a wrong consolidated number is more damaging than an absent one.
 *
 * THIS IS NOT AN ELIMINATION RULE. Compatibility of calendars says the period is the same period.
 * It says nothing about intercompany transactions, which stay governed by FIN-BLOCK-004 -- a
 * Taylor + Ventana figure remains the already-governed UNELIMINATED_SUM wherever it was one before.
 * G-05 makes the WINDOW legitimate; it does not make the SUM clean.
 */
export function resolveSharedReportingCalendar(companyIds: readonly unknown[]): ReportingCalendarResolution {
  const ids = Array.isArray(companyIds) ? companyIds : [];
  if (ids.length === 0) {
    return refused("UNKNOWN_COMPANY", "a consolidated reporting scope must name its operating companies");
  }

  const calendars: ReportingCalendar[] = [];
  for (const id of ids) {
    const one = resolveReportingCalendar(id);
    if (one.state !== "RESOLVED" || !one.calendar) return one;
    calendars.push(one.calendar);
  }

  const [first, ...rest] = calendars;
  for (const other of rest) {
    if (other.reportingTimeZone !== first.reportingTimeZone || other.reportingYearStartMonth !== first.reportingYearStartMonth) {
      return refused(
        "INCOMPATIBLE",
        "the operating companies in this scope do not share a reporting calendar, so a single period-relative figure across them would compare different spans",
      );
    }
  }
  return resolved(first);
}

/** Every company id that has a declared reporting calendar. */
export function companiesWithReportingCalendar(): readonly OperatingCompanyId[] {
  return Object.freeze(Object.keys(CALENDARS) as OperatingCompanyId[]);
}

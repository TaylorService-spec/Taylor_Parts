// WORKFORCE LOAD — the records that make a workload real.
//
// ============================ THE PROBLEM THIS FIXES ============================
//
// Eleven technicians already declared `certWorkload: none | normal | heavy | conflicting`, and not
// one job existed anywhere in the world. The labels described a workload nothing produced, which is
// the same shape as every defect this program has found: a fixture asserting a fact about itself.
//
// A load profile has to be CAUSED. So this seeds the assignments, and the certification checks
// DERIVE the profile from the assignment count and compare it against what the workforce declared.
// A disagreement between the two is a real finding, exactly as it was for inventory conditions.
//
// ============================ WHY THESE ARE STATIC RECORDS ============================
//
// No backend command creates a fieldops_jobs document. completeAssignedJob READS one and refuses to
// touch a job that is not yours and not in_progress; nothing anywhere writes one. So a technician's
// schedule is part of the world's starting position -- like its equipment and its customers -- and
// not the product of an operational service.
//
// That is recorded rather than worked around. Forcing these through a command that does not exist
// would mean inventing the command.
//
// ============================ THE THRESHOLDS ARE OURS, NOT THE PRODUCT'S ============================
//
// EOS owns no workload policy. There is no scheduling capacity rule, no overload threshold, and no
// business definition of "too many jobs" anywhere in the platform. These bands are CERTIFICATION
// EXPECTATIONS -- they exist so a fixture can be checked -- and presenting them as EOS scheduling
// policy would invent a business rule the product has never agreed to.
export const LOAD_BANDS = Object.freeze({
  LIGHT: { max: 1, label: "LIGHT" },
  NORMAL: { min: 2, max: 3, label: "NORMAL" },
  HEAVY: { min: 4, max: 5, label: "HEAVY" },
  OVERLOADED: { min: 6, label: "OVERLOADED" },
});

/** Fixture-only. Classify an active-assignment count into a certification band. */
export function loadBandFor(activeJobs) {
  if (activeJobs >= 6) return "OVERLOADED";
  if (activeJobs >= 4) return "HEAVY";
  if (activeJobs >= 2) return "NORMAL";
  return "LIGHT";
}

/**
 * The workload each declared category is built to produce.
 *
 * Chosen to land unambiguously INSIDE a band rather than on its edge: a fixture that sits exactly on
 * a threshold tests the threshold, not the world, and breaks the moment somebody adjusts a bound.
 */
const TARGET_JOBS = Object.freeze({
  none: 1,          // LIGHT
  normal: 3,        // NORMAL
  heavy: 5,         // HEAVY
  conflicting: 7,   // OVERLOADED
});

/** Statuses a seeded job may hold. `complete` is history; the other two are live work. */
export const ACTIVE_JOB_STATUSES = Object.freeze(["assigned", "in_progress"]);

const jobId = (technicianId, seq) => `cwjob_${technicianId}_${String(seq).padStart(2, "0")}`;

/**
 * Technician registry records.
 *
 * completeAssignedJob refuses to act when a caller's fieldops_technicians record is missing -- it
 * calls that an inconsistent mapping and fails closed. A world with assigned jobs and no technician
 * records would therefore be one where no technician could ever complete anything.
 */
export function buildTechnicianRecords(employees) {
  return employees
    .filter((e) => e.securityRole === "technician")
    .map((e) => ({
      collection: "fieldops_technicians",
      id: e.employeeId,
      data: {
        technicianId: e.employeeId,
        employeeId: e.employeeId,
        displayName: e.displayName,
        active: e.active !== false,
        available: e.certAvailable !== false,
        dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",
      },
    }));
}

/**
 * The jobs themselves.
 *
 * Every job names a real customer, location and equipment, taken from the world rather than
 * invented, so the reference sweep can resolve all of them.
 */
export function buildJobRecords(employees, { accounts, locationsByAccount, equipmentByAccount }) {
  const technicians = employees.filter((e) => e.securityRole === "technician");

  // SERVICEABLE ACCOUNTS ONLY, FILTERED UP FRONT.
  //
  // The first version walked every account and skipped the ones with no location or equipment,
  // which quietly produced fewer jobs than intended -- four technicians landed in the wrong band
  // and the fixture would have described a workload it had not built. Filtering first means the
  // target count is always reachable, and a shortfall becomes impossible rather than invisible.
  const serviceable = accounts.filter((a) =>
    (locationsByAccount.get(a) ?? []).length > 0 && (equipmentByAccount.get(a) ?? []).length > 0);
  if (serviceable.length === 0) return [];

  const records = [];
  let cursor = 0;
  for (const tech of technicians) {
    const target = TARGET_JOBS[tech.certWorkload] ?? 2;
    for (let seq = 0; seq < target; seq += 1) {
      const account = serviceable[(cursor * 7 + seq * 3) % serviceable.length];
      cursor += 1;
      const locs = locationsByAccount.get(account);
      const equips = equipmentByAccount.get(account);
      // The LAST job of each technician is left `assigned`; the rest are `in_progress`. Both count
      // as active work -- the distinction is whether it has started, not whether it is theirs.
      const status = seq === target - 1 ? "assigned" : "in_progress";
      records.push({
        collection: "fieldops_jobs",
        id: jobId(tech.employeeId, seq),
        data: {
          jobId: jobId(tech.employeeId, seq),
          technicianId: tech.employeeId,
          status,
          customerId: account,
          locationId: locs[seq % locs.length],
          equipmentId: equips[seq % equips.length],
          title: seq === 0 ? "Scheduled service call" : "Service visit",
          priority: seq === 0 ? "NORMAL" : "LOW",
          dataProvenance: "SYNTHETIC_CERTIFICATION_FACT",
        },
      });
    }
  }
  return records;
}
/** What the fixture INTENDS each technician's band to be, for comparison against the derived one. */
export function intendedBandFor(employee) {
  return loadBandFor(TARGET_JOBS[employee.certWorkload] ?? 2);
}

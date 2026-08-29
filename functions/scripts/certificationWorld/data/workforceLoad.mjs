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
 * The canonical technician vocabulary, which is NOT the employee vocabulary.
 *
 * A technician record is `{ id, name, phone, status }` -- stated in modules/technicians/
 * Technicians.jsx's own header, enforced for client writes by firestore.rules, and documented at
 * length in test/techniciansSurfaceEmployeeDivergence.test.jsx. `status` is a live job-assignment
 * state, one of these three, and it is a different concept from an employee's `employmentStatus`.
 *
 * Duplicated as a literal rather than imported because this is a plain seed script and the authority
 * (scheduling/schedulingRepository.ts's GOVERNED_TECHNICIAN_STATUSES) is TypeScript compiled to
 * lib/ -- a seed script that could not run before a build would be worse. The mirror is not left to
 * trust: certificationWorldTechnicianShape.test.mjs imports the REAL set and asserts every status
 * emitted here is in it, so a drift fails the build rather than the sandbox.
 */
const TECHNICIAN_STATUS_AVAILABLE = "available";
const TECHNICIAN_STATUS_OFF_SHIFT = "off_shift";

/**
 * Technician registry records.
 *
 * completeAssignedJob refuses to act when a caller's fieldops_technicians record is missing -- it
 * calls that an inconsistent mapping and fails closed. A world with assigned jobs and no technician
 * records would therefore be one where no technician could ever complete anything.
 *
 * ============================ WHY THIS WRITES `name` AND `status` ============================
 *
 * It used to write `displayName`, `active` and `available` -- the EMPLOYEE vocabulary, into the
 * TECHNICIAN collection. Those are two different shapes for two different concepts, and the
 * divergence is governance-recognised (the Employee/User/Technician split is approved but
 * unimplemented, so there is no derivation path between them: this generator is the only writer).
 *
 * The consequence was not cosmetic and reached production-shaped behaviour in the sandbox:
 *
 *   - `name` absent  -> resolveTechnicianIdentity correctly refused to print a raw document id and
 *     every one of the eleven seeded technicians rendered as "Unknown technician" on the Dispatch
 *     board and blank in the Employees admin surface.
 *   - `status` absent -> governed scheduling placement refused all eleven with
 *     TECHNICIAN_INELIGIBLE. A third of the sandbox roster could not be scheduled at all. Verified
 *     live on eos-platform-sandbox 2026-08-27, not inferred.
 *
 * Nothing ever read the fields it was writing. `active` and `available` on a technician record are
 * consumed by no application code, no certification harness and no verifier -- verifyWorkforceLoad
 * counts these documents and reads every field it actually uses (certWorkload, certAvailable) off
 * the EMPLOYEE record. So they are gone rather than carried: keeping them would leave two spellings
 * of identity in one document and invite the next reader to pick the wrong one.
 *
 * Every value below already existed on the employee fixture. Nothing is invented, and no name is
 * fabricated to make a screenshot look better.
 */
export function buildTechnicianRecords(employees) {
  return employees
    .filter((e) => e.securityRole === "technician")
    .map((e) => ({
      collection: "fieldops_technicians",
      id: e.employeeId,
      data: {
        // Identity + linkage. technicianId must equal the document id: transitionWorkOrder and
        // completeAssignedJob both address technicians by that id, never by employeeId.
        technicianId: e.employeeId,
        employeeId: e.employeeId,
        // The canonical display field. The board reads `name` and nothing else.
        name: e.displayName,
        phone: e.certPhone,
        // The live job-assignment state, which is what placement eligibility checks. An employee the
        // fixture declares unavailable becomes off_shift rather than being omitted -- an absent
        // technician record would break completeAssignedJob's mapping check, which is the whole
        // reason these documents exist.
        status: e.certAvailable !== false ? TECHNICIAN_STATUS_AVAILABLE : TECHNICIAN_STATUS_OFF_SHIFT,
        // Provenance and reset scoping. `reset` is marker-scoped, so removing this would strand
        // every record it writes beyond the reach of the governed cleanup path.
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

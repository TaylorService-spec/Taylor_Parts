// SERVICE JOB OPERATING COMPANY — an AUTHORED certification-world fact (Owner ruling R-11, 2026-08-30).
//
// Which operating company is responsible for each synthetic service Job. Same principle as the
// equipment fleets: DECLARED, never inferred.
//
// NOT DERIVED FROM the technician, the customer, the location name, salesOrderId, lineOfBusiness,
// the job number, a fixture index, or any string pattern. Every one of those is prohibited by the
// ruling, and the technician is the tempting one -- a Job names its technician right there, and
// reading a company off that would collapse ownership into assignment, which is the distinction the
// whole model exists to hold.
//
// GROUPED BY TECHNICIAN, ASSIGNED BY JOB. The technician is the natural service-scenario grouping
// (jobs are minted per technician), so a technician never carries jobs for both companies -- a
// fixture where one person works for two operating companies on alternate days would be a worse
// certification world than one that simply picks. But the GROUPING is not the RULE: the rule was a
// one-time 2:1 target over job COUNT, solved exactly (27 Taylor / 14 Ventana across 41 jobs, 11
// technicians) and then persisted as the literal values below.
//
// THE SOLVER IS GONE AND MUST NOT COME BACK. Nothing computes these. A runtime that re-derived them
// from technician order would reassign jobs the moment a technician was added, which is exactly the
// failure the equipment ruling already retired once.
//
// The 4 NON-FIXTURE jobs are deliberately absent. They are not certification data and must not be
// authored -- they stay unresolved for explicit remediation.

export const SERVICE_JOB_OPERATING_COMPANY = Object.freeze({
  "cwjob_cw-emp-012_00": "ventana",
  "cwjob_cw-emp-013_00": "taylor",
  "cwjob_cw-emp-013_01": "taylor",
  "cwjob_cw-emp-013_02": "taylor",
  "cwjob_cw-emp-014_00": "ventana",
  "cwjob_cw-emp-014_01": "ventana",
  "cwjob_cw-emp-014_02": "ventana",
  "cwjob_cw-emp-014_03": "ventana",
  "cwjob_cw-emp-014_04": "ventana",
  "cwjob_cw-emp-015_00": "ventana",
  "cwjob_cw-emp-015_01": "ventana",
  "cwjob_cw-emp-015_02": "ventana",
  "cwjob_cw-emp-015_03": "ventana",
  "cwjob_cw-emp-015_04": "ventana",
  "cwjob_cw-emp-015_05": "ventana",
  "cwjob_cw-emp-015_06": "ventana",
  "cwjob_cw-emp-016_00": "ventana",
  "cwjob_cw-emp-017_00": "taylor",
  "cwjob_cw-emp-017_01": "taylor",
  "cwjob_cw-emp-017_02": "taylor",
  "cwjob_cw-emp-018_00": "taylor",
  "cwjob_cw-emp-018_01": "taylor",
  "cwjob_cw-emp-018_02": "taylor",
  "cwjob_cw-emp-018_03": "taylor",
  "cwjob_cw-emp-018_04": "taylor",
  "cwjob_cw-emp-019_00": "taylor",
  "cwjob_cw-emp-019_01": "taylor",
  "cwjob_cw-emp-019_02": "taylor",
  "cwjob_cw-emp-019_03": "taylor",
  "cwjob_cw-emp-019_04": "taylor",
  "cwjob_cw-emp-019_05": "taylor",
  "cwjob_cw-emp-019_06": "taylor",
  "cwjob_cw-emp-020_00": "taylor",
  "cwjob_cw-emp-021_00": "taylor",
  "cwjob_cw-emp-021_01": "taylor",
  "cwjob_cw-emp-021_02": "taylor",
  "cwjob_cw-emp-022_00": "taylor",
  "cwjob_cw-emp-022_01": "taylor",
  "cwjob_cw-emp-022_02": "taylor",
  "cwjob_cw-emp-022_03": "taylor",
  "cwjob_cw-emp-022_04": "taylor",
});

/**
 * The operating company responsible for a fixture Job, or null.
 *
 * A LOOKUP. A job id absent from the map -- any non-fixture job -- returns null, and the caller
 * leaves it unresolved rather than guessing.
 */
export function serviceJobOperatingCompany(jobId) {
  return SERVICE_JOB_OPERATING_COMPANY[jobId] ?? null;
}

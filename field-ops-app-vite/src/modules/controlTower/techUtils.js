// Groups governed Work Orders by their assigned technician (assignedTechId),
// bucketing unassigned Work Orders into "UNASSIGNED".
//
// F0 -- reads `assignedTechId` (the governed Work Order field). The legacy
// `technicianId` fallback is retained ONLY so this stays total for any caller
// still passing a legacy-shaped record; it is not a supported input.
export const groupJobsByTechnician = (jobs = []) => {
  const map = {};

  jobs.forEach((job) => {
    const tech = job.assignedTechId || job.technicianId || "UNASSIGNED";

    if (!map[tech]) {
      map[tech] = [];
    }

    map[tech].push(job);
  });

  return map;
};

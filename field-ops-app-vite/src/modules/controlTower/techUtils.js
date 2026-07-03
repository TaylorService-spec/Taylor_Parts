// Groups jobs by their assigned technician (technicianId), bucketing
// jobs with no technician into "UNASSIGNED".
export const groupJobsByTechnician = (jobs = []) => {
  const map = {};

  jobs.forEach((job) => {
    const tech = job.technicianId || "UNASSIGNED";

    if (!map[tech]) {
      map[tech] = [];
    }

    map[tech].push(job);
  });

  return map;
};

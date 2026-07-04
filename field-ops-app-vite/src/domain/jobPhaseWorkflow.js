import { JOB_PHASE } from "./constants";

// Sprint 4: transition rules for the additive job.phase field (see
// constants.js's JOB_PHASE comment for why this is separate from, and
// does not replace, JOB_STATUS/canTransitionJob() in jobWorkflow.js).
const phaseTransitions = {
  [JOB_PHASE.CREATED]: [JOB_PHASE.ASSIGNED],
  [JOB_PHASE.ASSIGNED]: [JOB_PHASE.EN_ROUTE],
  [JOB_PHASE.EN_ROUTE]: [JOB_PHASE.IN_PROGRESS],
  // A job may need zero, one, or many parts -- PARTS_USED can repeat
  // (each part-use event re-enters it) and IN_PROGRESS can go straight
  // to COMPLETED if the job never needed a PARTS_USED event at all.
  [JOB_PHASE.IN_PROGRESS]: [JOB_PHASE.PARTS_USED, JOB_PHASE.COMPLETED],
  [JOB_PHASE.PARTS_USED]: [JOB_PHASE.PARTS_USED, JOB_PHASE.COMPLETED],
  [JOB_PHASE.COMPLETED]: [],
};

export function canTransitionPhase(currentPhase, nextPhase) {
  return phaseTransitions[currentPhase]?.includes(nextPhase) ?? false;
}

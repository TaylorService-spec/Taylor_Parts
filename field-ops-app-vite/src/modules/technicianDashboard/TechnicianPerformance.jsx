// TECHNICIAN PERFORMANCE -- what this technician is measured against, and what the platform cannot
// measure yet.
//
// ============================ WHY THE EMPTY SLOTS ARE THE POINT ============================
//
// The Owner's direction is explicit: "Do not reward throughput alone. Visually balance PRODUCTIVITY,
// ON-TIME EXECUTION and QUALITY."
//
// Today only PRODUCTIVITY is governed. A screen that showed a completion count and stopped would
// read as though throughput IS the job -- not because anyone claimed it, but because it would be the
// only number on the page, and the only number on a page is the score.
//
// So the other two are RESERVED AND VISIBLY EMPTY, each naming what is missing. That is a design
// decision with a cost (a less tidy screen) paid deliberately, because the alternative is a
// performance surface that quietly redefines a technician's job as speed. The empty slots are the
// platform saying it knows the picture is incomplete.
//
// The three blockers are real and none is a shrug:
//   ON TIME       nothing defines it. scheduledStart is the only date authority, and a Work Order
//                 records no promise, commitment or SLA to be on time AGAINST.
//   FIRST-TIME FIX no revisit linkage exists in the model at all -- two Work Orders at one Account
//                 for one machine are two independent records, so the denominator cannot be formed.
//   JOBS/WORKDAY  the denominator is undecided AND there is no reporting-period authority. A
//                 technician with no recorded working schedule renders "not recorded", never zero.
import RuledSection from "../../shared/ui/RuledSection.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import GoalGrid from "../dashboard/GoalGrid.jsx";
import { usePerformanceGoals } from "../../hooks/usePerformanceGoals.js";
import { reportingDayIso } from "../../domain/reportingPeriod.js";

// The governed reporting day (G-05, Decision #163), not the browser's. A technician's targets must
// not roll over at a different moment than the dispatcher's view of the same work.
function reportingToday() {
  return reportingDayIso(Date.now());
}

export default function TechnicianPerformance({ employeeId }) {
  // No employee link, no targets. Rendered as an honest state rather than hidden: a technician whose
  // account is not linked to an employee record should learn that, since it is fixable and it also
  // explains why nobody has been able to set them a goal.
  const targets = employeeId
    ? [
        { metricId: "technician.workOrder.completed.cumulative.count", targetScopeType: "EMPLOYEE", targetScopeId: employeeId },
        { metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: employeeId },
      ]
    : [];
  const feed = usePerformanceGoals(targets, reportingToday());

  return (
    <RuledSection title="Performance against goal" id="technician-performance">
      {employeeId ? (
        <GoalGrid targets={targets} feed={feed} />
      ) : (
        <HonestState
          state={HONEST_STATE.UNKNOWN}
          subject="Your targets"
          detail="Your account is not linked to an employee record, so no target can be set for you. An administrator can link it in Administration > Employees."
        />
      )}

      {/* NOT_ENABLED, not UNAVAILABLE, and the difference is assistive rather than cosmetic:
          HonestState's UNAVAILABLE branch carries role="alert", which makes a screen reader announce
          it on every page load. An alert is for something that just went wrong and needs attention.
          This is a permanent, designed statement about what the platform does not measure -- true on
          every load, actionable by nobody in the moment, and announcing it as an alert would train a
          technician to ignore alerts. Caught by useCurrentTechnicianFailClosed's queryByRole("alert")
          assertion, which is a stricter reviewer than the eye. */}
      <HonestState
        state={HONEST_STATE.NOT_ENABLED}
        detail="On-time completion, first-time fix and jobs per workday are not measured yet. Each needs a business definition the platform does not have: what counts as on time, how a repeat visit is linked to the original job, and what a workday is when a working schedule may not be recorded."
      />
    </RuledSection>
  );
}

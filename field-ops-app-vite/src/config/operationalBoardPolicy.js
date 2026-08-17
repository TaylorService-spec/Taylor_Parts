// Operational board scope — declared policy, not UI magic.
//
// A dispatch board is not a list. It is a claim about a COMPLETE working set: every job a
// dispatcher could act on right now. That claim is only true if the scope is stated
// somewhere a person can read and a tenant can eventually change, which is why the horizon
// lives here rather than as two numbers inside a component.
//
// Owner ruling, 2026-08-17. The default operational scope is:
//   - Work Orders in actionable/open lifecycle states, AND scheduled within roughly
//     30 days back to 90 days forward; PLUS
//   - any still-open work OUTSIDE that window that remains operationally actionable —
//     overdue and unscheduled work specifically.
//
// The second clause is the one that matters. A board that showed only the window would
// hide work that aged out of it, and aging out is exactly what overdue MEANS: the jobs
// most in need of a dispatcher are the ones a naive date filter drops first.

export const OPERATIONAL_BOARD_POLICY = Object.freeze({
  /** Days back from today. Scheduled work older than this is still included if OPEN. */
  horizonPastDays: 30,
  /** Days forward from today. Work scheduled beyond this is planned, not actionable. */
  horizonForwardDays: 90,

  /**
   * Lifecycle states a dispatcher can still act on.
   *
   * Derived by EXCLUDING the terminal states rather than by listing the open ones, so a
   * new lifecycle state is open by default. The failure modes are not symmetric: a new
   * state wrongly treated as open shows a dispatcher an extra job, while a new state
   * wrongly treated as terminal makes real work vanish from the board with nothing to
   * indicate it ever existed.
   */
  terminalStates: Object.freeze(["CLOSED", "CANCELLED"]),

  /**
   * The largest working set this board will claim to show COMPLETELY.
   *
   * Not a page size — there is no page. It is the point past which the board stops
   * claiming completeness and says so, because a dispatch board whose scope has grown to
   * thousands of open jobs is reporting an operational problem, not a paging problem. The
   * honest response is "this scope is larger than a board can show", never a silent first
   * N that looks like the whole queue.
   */
  completenessCap: 500,
});

/**
 * The scheduled-date window, resolved against a supplied clock.
 *
 * `now` is a parameter rather than read here, so the window is a pure function of policy
 * and time. A board whose scope depended on when a module happened to be imported would
 * drift across a midnight boundary and be untestable.
 */
export function boardWindow(now, policy = OPERATIONAL_BOARD_POLICY) {
  const day = 24 * 60 * 60 * 1000;
  return Object.freeze({
    from: new Date(now.getTime() - policy.horizonPastDays * day),
    to: new Date(now.getTime() + policy.horizonForwardDays * day),
  });
}

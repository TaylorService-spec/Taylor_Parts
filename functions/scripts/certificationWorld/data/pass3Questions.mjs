// RETURNS, G09, G10, G11 AND WORKLOAD QUESTIONS — answers read from the world's own evidence.

/**
 * @param {object} ret   return-scenarios.json
 * @param {object} truth reporting-truth.json
 * @param {object} golden golden-manifest.json
 */
export function pass3Questions(ret, truth, golden) {
  const g09 = golden.scenarios.find((s) => s.id === "G09");
  const g10 = golden.scenarios.find((s) => s.id === "G10");
  const g09line = g09?.lines?.[0] ?? {};
  const repeat = truth.service.repeatServiceEquipment[0] ?? {};
  const dense = truth.service.customersWithMultipleWorkOrders
    .find((c) => c.customerId === "cw-acct-0003") ?? { customerId: "cw-acct-0003", workOrders: [] };
  const R = ret.R01 ?? {};

  return [
    // ── RETURNS ────────────────────────────────────────────────────────────────────────────────
    {
      topic: "returns", persona: "parts associate",
      question: `Has ${R.part} been returned?`,
      answer: `Yes — ${R.quantity} units, awaiting disposition`,
      answerType: "JUDGEMENT", wrongAnswers: ["No"],
      why: "the return is recorded. That is a different fact from whether it can be used.",
    },
    {
      topic: "returns", persona: "parts associate",
      question: "Is it back in usable inventory?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: `warehouseAvailable is unchanged at ${R.after?.warehouseAvailable}. Returned and available are `
        + "different facts, and a system that conflates them credits stock for goods nobody has inspected.",
    },
    {
      topic: "returns", persona: "parts manager",
      question: "Why didn't inventory increase when the return was logged?",
      answer: "Intake records that something came back; it does not decide what happens to it",
      answerType: "EXPLANATION", wrongAnswers: ["a bug", "it will sync later"],
      why: "no ledger event is written at intake, by design. Writing one would BE the automatic "
        + "restock the rule forbids.",
    },
    {
      topic: "returns", persona: "parts manager",
      question: "How many of those units will go back into stock?",
      answer: "UNKNOWN", answerType: "UNKNOWN", wrongAnswers: ["0", String(R.quantity)],
      why: "no disposition has happened, so how much returns to stock is undecided — not measured as "
        + "none. Zero would be a claim somebody made; UNKNOWN is the truth.",
    },
    {
      topic: "returns", persona: "warehouse manager",
      question: "What still needs to happen before it is available?",
      answer: "A disposition decision — which does not exist in this system yet",
      answerType: "EXPLANATION", wrongAnswers: ["nothing", "a manager approval"],
      why: "intake and disposition are separate authorities and only the first is built. Saying "
        + "'awaiting approval' would imply a queue somebody could work.",
    },
    {
      topic: "returns", persona: "warehouse manager",
      question: "Who took the return in?",
      answer: R.clerk, answerType: "EMPLOYEE", wrongAnswers: ["the system", "unknown"],
      why: "receivedBy names the principal. A return nobody is accountable for is a box with a note on it.",
    },
    {
      topic: "returns", persona: "parts associate",
      question: "Can I log a return if I only do put-away?",
      answer: "DENIED", answerType: "DENIED", wrongAnswers: ["Yes"],
      why: `${ret.authorization.deniedEmployee} was refused ${ret.authorization.code}. Returns intake `
        + "is its own capability — deliberately not receiving, whose whole meaning is accepting stock "
        + "INTO sellable inventory.",
    },
    {
      topic: "returns", persona: "parts manager",
      question: "Which returns are awaiting disposition?",
      answer: `All ${truth.operations.returns.total} of them`,
      answerType: "LIST", wrongAnswers: ["none"],
      why: "AWAITING_DISPOSITION is the only state a return can hold. Every return in this world is "
        + "in it, and none of them has moved any stock.",
    },
    {
      topic: "returns", persona: "service manager",
      question: "The customer says they sent it back damaged. Does the system record that?",
      answer: "Yes — condition is recorded as observed at the dock",
      answerType: "EXPLANATION", wrongAnswers: ["it decides to scrap it"],
      why: "'the box is crushed' is something the receiver can see; 'therefore scrap it' is a policy. "
        + "Condition gates nothing here.",
    },
    // ── G09 ────────────────────────────────────────────────────────────────────────────────────
    {
      topic: "inbound sufficiency", persona: "parts manager",
      question: `${g09?.woNumber} needs ${g09line.planned} of ${g09line.partId} and there is already an order out. Do we wait?`,
      answer: "No — order more", answerType: "JUDGEMENT", wrongAnswers: ["Yes, wait"],
      why: `warehouse ${g09line.warehouse} plus inbound ${g09line.inbound} is `
        + `${(g09line.warehouse ?? 0) + (g09line.inbound ?? 0)}, still short of ${g09line.planned}. `
        + "An open order is not the same as enough on order.",
    },
    {
      topic: "inbound sufficiency", persona: "general manager",
      question: "How is this different from the other job that is waiting on a delivery?",
      answer: "There, inbound covers the shortage; here it does not",
      answerType: "EXPLANATION", wrongAnswers: ["it is the same", "one is older"],
      why: "the two are indistinguishable to anyone who checks only whether a purchase order EXISTS. "
        + "The quantity has to be compared against the shortage.",
    },
    {
      topic: "inbound sufficiency", persona: "parts manager",
      question: "If every unit on order arrived tomorrow, could the job be filled?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: `still short by ${(g09line.planned ?? 0) - ((g09line.warehouse ?? 0) + (g09line.inbound ?? 0))} `
        + "after everything lands. That is the whole scenario.",
    },
    // ── G10 ────────────────────────────────────────────────────────────────────────────────────
    {
      topic: "repeat failure", persona: "service manager",
      question: `How many times have we been out to ${repeat.equipmentId}?`,
      answer: String(repeat.visits), answerType: "NUMBER", wrongAnswers: ["3", "1"],
      why: "four work orders reference this unit. The count is not the same question as whether it "
        + "is a recurring fault.",
    },
    {
      topic: "repeat failure", persona: "service manager",
      question: "Is that machine a recurring problem, or just a busy one?",
      answer: "Recurring — three of the four visits share the same symptom",
      answerType: "JUDGEMENT", wrongAnswers: ["four repeat visits", "no, they are unrelated"],
      why: "the fourth visit is an unrelated intermittent shutdown. Counting visits overstates the "
        + "pattern; reading what they were FOR is what distinguishes a fault from a workload.",
    },
    {
      topic: "repeat failure", persona: "general manager",
      question: "Does the system flag this unit as a repeat failure?",
      answer: "No — nothing carries such a flag", answerType: "EXPLANATION",
      wrongAnswers: ["yes, it is flagged"],
      why: "in a real business nobody labels the third visit as the third visit. A system that can "
        + "only report what was labelled cannot notice a pattern.",
    },
    // ── G11 ────────────────────────────────────────────────────────────────────────────────────
    {
      topic: "dense customer", persona: "service manager",
      question: `What is going on at ${dense.customerId}?`,
      answer: `${dense.workOrders.length} open work orders across different units`,
      answerType: "LIST", wrongAnswers: ["one recurring problem"],
      why: "several machines in service at once. Busy, not broken — the opposite reading from the "
        + "repeat-failure unit.",
    },
    {
      topic: "dense customer", persona: "general manager",
      question: "Is that account having repeated trouble with one machine?",
      answer: "No — different units", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "same customer, three different equipment ids. A screen that renders this identically to "
        + "the repeat-failure case has lost the difference.",
    },
    // ── WORKLOAD / ATTENTION ───────────────────────────────────────────────────────────────────
    {
      topic: "manager attention", persona: "parts manager",
      question: "What needs my attention in the parts room today?",
      answer: `${truth.operations.cycleCounts.awaitingDecision} counts awaiting a decision, `
        + `${truth.operations.returns.awaitingDisposition} returns awaiting disposition`,
      answerType: "LIST", wrongAnswers: ["nothing"],
      why: "both are known disagreements or undecided items that no automatic process will resolve. "
        + "They are the queue that only a person can clear.",
    },
    {
      topic: "manager attention", persona: "general manager",
      question: "How many jobs are blocked on parts right now?",
      answer: String(truth.service.partsConstrained), answerType: "NUMBER",
      wrongAnswers: [String(truth.service.workOrders), "0"],
      why: "constrained means the Parts Room cannot fill at least one planned line. Not the same as "
        + "the total number of open jobs.",
    },
    {
      topic: "manager attention", persona: "general manager",
      question: "Did anything change the value of our inventory this week without goods moving?",
      answer: `Yes — ${truth.inventory.movementsByCause.cycleCorrection} units of cycle-count correction`,
      answerType: "NUMBER", wrongAnswers: ["no", "only receipts"],
      why: "a reconciliation corrects the books toward physical truth. Transfers net to zero and "
        + "receipts are goods arriving; this is neither.",
    },
  ];
}

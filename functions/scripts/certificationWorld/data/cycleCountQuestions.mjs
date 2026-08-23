// CYCLE COUNT AND G07 QUESTIONS — answers read from the evidence the world actually produced.
//
// The recurring trap across this whole set is the same one: treating a count as a correction. A
// count is somebody's report of what they saw. It becomes a correction only when a different person
// with different authority decides the books were wrong.

/**
 * @param {object} cc   cycle-count-scenarios.json — C01..C04, blind count, SoD, reconciliation
 * @param {object} g07  g07-cycle-variance.json — before / counted / after, with capability proof
 */
export function cycleCountQuestions(cc, g07) {
  const m = g07.materiality;
  return [
    {
      topic: "cycle count", persona: "parts manager",
      question: `What did the count of ${g07.before.partId} find?`,
      answer: `${g07.counted.observed} on the shelf against ${g07.counted.expected} on the books`,
      answerType: "NUMBER", wrongAnswers: [String(g07.after.warehouse), "nothing"],
      why: "the count reports an observation. What the books said is a separate number, and the gap "
        + "between them is the whole point of counting.",
    },
    {
      topic: "cycle count", persona: "parts associate",
      question: "I submitted my count. Did inventory change?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: `warehouse stayed at ${g07.counted.warehouse} after submission. Counting is not adjusting: `
        + "if reporting a shortfall wrote it off, one person could find and bury the same problem in "
        + "a single motion.",
    },
    {
      topic: "cycle count", persona: "parts manager",
      question: `Why is there a variance on ${g07.before.partId}?`,
      answer: `The shelf holds ${Math.abs(g07.counted.variance)} fewer than the ledger expected`,
      answerType: "EXPLANATION", wrongAnswers: ["the count is wrong", "the system is wrong"],
      why: "a variance is a disagreement, not a verdict. Which side is right is what reconciliation "
        + "decides, and it may decide the count is not trusted.",
    },
    {
      topic: "cycle count", persona: "warehouse manager",
      question: `Who counted ${g07.before.partId}?`,
      answer: g07.counter.employeeId, answerType: "EMPLOYEE",
      wrongAnswers: [g07.reconciler.employeeId, "the system"],
      why: "the count records submittedBy, and it has to: a variance nobody is accountable for is a "
        + "number with no story behind it.",
    },
    {
      topic: "cycle count", persona: "warehouse manager",
      question: "Who is allowed to approve that variance?",
      answer: `${g07.reconciler.employeeId} — not the person who counted it`,
      answerType: "EMPLOYEE", wrongAnswers: [g07.counter.employeeId, "anyone in the parts room"],
      why: `${g07.counter.employeeId} holds ${g07.counter.holds} and is denied `
        + `${g07.counter.deniedCapability}; ${g07.reconciler.employeeId} is the reverse.`,
    },
    {
      topic: "cycle count", persona: "parts associate",
      question: "Can I approve my own count?",
      answer: "DENIED", answerType: "DENIED", wrongAnswers: ["Yes, I counted it"],
      why: `refused ${g07.selfApprovalRefusal} by the real service. Two mechanisms stand behind this: `
        + "the capability is carried by a different Role, and even holding both, an actor may not "
        + "settle a MATERIAL variance they themselves submitted.",
    },
    {
      topic: "cycle count", persona: "general manager",
      question: "What counts as a variance big enough to need my sign-off?",
      answer: `${m.absoluteUnits} units, or ${m.relativeFraction * 100}% of what was expected — whichever trips first`,
      answerType: "EXPLANATION", wrongAnswers: ["any variance", "a percentage only"],
      why: "either bound alone fails at one end of the scale. Three missing out of three thousand is "
        + "noise; three missing out of four is the whole count. A percentage alone lets small "
        + "populations dodge review entirely.",
    },
    {
      topic: "cycle count", persona: "parts manager",
      question: "Has the variance been reconciled?",
      answer: g07.after.countState, answerType: "STATUS",
      wrongAnswers: ["COUNTED", "OPEN"],
      why: "RECONCILED means somebody decided. COUNTED means the disagreement is recorded and "
        + "nobody has settled it yet.",
    },
    {
      topic: "cycle count", persona: "parts manager",
      question: "Which counts are still waiting on a decision?",
      answer: "The COUNTED ones — a variance is visible and the books are untouched",
      answerType: "EXPLANATION", wrongAnswers: ["none", "all of them"],
      why: "this is the queue that matters operationally: every one of them is a known disagreement "
        + "between the shelf and the ledger that nobody has resolved.",
    },
    {
      topic: "cycle count", persona: "warehouse manager",
      question: "How much did inventory change after reconciliation?",
      answer: String(g07.after.adjustment?.quantity ?? g07.counted.variance),
      answerType: "NUMBER", wrongAnswers: ["0", String(g07.counted.observed)],
      why: `exactly the variance: ${g07.before.warehouse} became ${g07.after.warehouse}, which is `
        + "what the counter saw. Not a round number, not a write-off — the difference.",
    },
    {
      topic: "cycle count", persona: "general manager",
      question: "Why did company inventory change when nothing arrived and nothing left?",
      answer: "The books were corrected toward what is physically there",
      answerType: "EXPLANATION", wrongAnswers: ["stock was moved", "stock was received"],
      why: `${g07.before.company} became ${g07.after.company}. A transfer relocates and conserves the `
        + "company total; a reconciliation corrects it. A system where both behaved the same way "
        + "could not tell you which had happened.",
    },
    {
      topic: "cycle count", persona: "general manager",
      question: "Can I see who authorised that adjustment?",
      answer: `${g07.reconciler.employeeId}, and it points at the count that justified it`,
      answerType: "EMPLOYEE", wrongAnswers: ["no", "the system"],
      why: "the ledger row is ADJUSTED with an ADJUSTMENT source naming the cycle count. An "
        + "adjustment with no authorising record behind it is a number somebody typed.",
    },
    {
      topic: "cycle count", persona: "parts associate",
      question: "The count was cancelled. Did that change anything?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "a cancelled count moved no stock, because no count moves stock. Cancelling abandons an "
        + "observation; there is nothing to unwind.",
    },
    {
      topic: "cycle count", persona: "parts manager",
      question: "Can a reconciled count be re-counted or its decision reversed?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "both are refused STATUS_INVALID. A decision that could be quietly flipped afterwards is "
        + "not a control, and a recount after adjustment would be counting a different situation.",
    },
    {
      topic: "cycle count", persona: "technician",
      question: "Does a cycle count on a part affect my work order?",
      answer: "Only after reconciliation, and only if it changes availability",
      answerType: "EXPLANATION", wrongAnswers: ["immediately", "never"],
      why: "counting is invisible to demand. A settled variance changes what the Parts Room can "
        + "issue, and that is when a job's fulfillability can move.",
    },
  ];
}

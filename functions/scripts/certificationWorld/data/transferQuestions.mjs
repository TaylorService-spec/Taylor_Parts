// TRANSFER AND G06 QUESTIONS — answers read from the evidence the world actually produced.
//
// Kept beside the other question sources rather than inline in the builder, so the corpus can grow
// per domain without one file becoming the place everything is written.
//
// Every answer here is derived from the transfer and G06 evidence files. Nothing is typed in from
// memory: a question whose answer drifts is a question about a world that has changed, and it should
// fail loudly rather than quietly describe a world that no longer exists.

/**
 * @param {object} xfer  transfer-scenarios.json — T01..T06, idempotency, authorization
 * @param {object} g06   g06-transfer-recovery.json — before / inTransit / after / transfer
 */
export function transferQuestions(xfer, g06) {
  const b = g06.before;
  const a = g06.after;
  const t = g06.transfer;
  const trucks = b.byTruck.map(([truck, qty]) => `${truck}: ${qty}`).join(", ");

  return [
    {
      topic: "transfer", persona: "parts associate",
      question: `Where is the ${b.partId} we need for ${b.woNumber}?`,
      answer: `${b.warehouse} in the warehouse, ${b.mobile} on trucks (${trucks})`,
      answerType: "LOCATIONS", wrongAnswers: [String(b.company), "we are out"],
      why: "the company owns plenty and the Parts Room still cannot fill the job. Answering with the "
        + "total answers a different question from the one that was asked.",
    },
    {
      topic: "transfer", persona: "parts manager",
      question: `Could the Parts Room fill ${b.woNumber} before the transfer?`,
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: `planned ${b.planned} against warehouse ${b.warehouse} -- short ${b.warehouseShortage}, `
        + `while the company owned ${b.company}.`,
    },
    {
      topic: "transfer", persona: "parts manager",
      question: "Should we order more of this part, or move what we have?",
      answer: "Move it", answerType: "JUDGEMENT", wrongAnswers: ["Order more"],
      why: "company shortage is zero. Ordering here buys stock the business already owns and is "
        + "currently sitting on a van.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: `How much was transferred to unblock ${b.woNumber}, and from where?`,
      answer: `${t.quantity} from ${t.origin.locationId}`,
      answerType: "NUMBER", wrongAnswers: [String(b.mobile), String(b.planned)],
      why: "exactly the shortage. A transfer is a response to a need, not a redistribution of "
        + "everything that happened to be available.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: "Why did company inventory stay the same after the transfer?",
      answer: `It was relocated, not created -- ${b.company} before and after`,
      answerType: "EXPLANATION", wrongAnswers: ["it went up", "it went down"],
      why: "a transfer pairs an OUT at the origin with an equal IN at the destination, so the sum "
        + "over both is exactly zero. Every time, or it was not a transfer.",
    },
    {
      topic: "transfer", persona: "technician",
      question: `Can ${b.woNumber} be filled now?`,
      answer: "Yes", answerType: "JUDGEMENT", wrongAnswers: ["No"],
      why: `warehouse ${a.warehouse} against planned ${a.planned} -- the shortage closed exactly.`,
    },
    {
      topic: "transfer", persona: "dispatcher",
      question: "Has the transfer been dispatched, and has the destination received it?",
      answer: String(t.status), answerType: "STATUS",
      wrongAnswers: ["REQUESTED", "PARTIALLY_RECEIVED"],
      why: "dispatch and receive are separate acts: REQUESTED -> IN_TRANSIT -> COMPLETED. Only the "
        + "last of those puts stock at the destination.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: "While a transfer is in transit, where is the stock?",
      answer: "Neither location", answerType: "EXPLANATION",
      wrongAnswers: ["at the origin", "at the destination"],
      why: "it leaves the origin at dispatch and arrives at receipt"
        + (xfer.T04 ? `, so the location sum falls from ${xfer.T04.before.companyByLocation} to `
          + `${xfer.T04.inTransit.companyByLocation} in between` : "")
        + ". In transit is a real place that a total summed over locations does not model.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: "Who performed the transfer?",
      answer: `created and dispatched by ${t.actors.create}, received by ${t.actors.receive}`,
      answerType: "EMPLOYEE", wrongAnswers: ["the system", "an administrator"],
      why: "every transfer movement names the principal who caused it, and the two ends need not be "
        + "the same person.",
    },
    {
      topic: "transfer", persona: "parts associate",
      question: "I scanned the part on the truck. Has it moved to the warehouse?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "scanning is not moving. Custody changes only when the trusted transfer command dispatches "
        + "and receives it -- a scan that moved stock would be inventory changing because somebody "
        + "looked at it.",
    },
    {
      topic: "transfer", persona: "warehouse associate",
      question: "I do put-away. Can I move stock between locations?",
      answer: "DENIED", answerType: "DENIED", wrongAnswers: ["Yes"],
      why: `${xfer.authorization.deniedEmployee} was refused ${xfer.authorization.code} by the real `
        + "service on this exact request. Warehouse work is not transfer authority.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: "What happens if we ask to move more than the source is carrying?",
      answer: "Refused -- INSUFFICIENT_STOCK", answerType: "REFUSAL",
      wrongAnswers: ["it moves what it can", "the balance goes negative"],
      why: `asked ${xfer.T03.requested} against ${xfer.T03.available} on hand. Quietly moving less than `
        + "was asked for would be a different transfer from the one anybody requested.",
    },
    {
      topic: "transfer", persona: "warehouse manager",
      question: "Can a transfer be cancelled after it has been dispatched?",
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "cancellation is only domain-safe before dispatch. Afterwards the stock has already left "
        + "the origin, and cancelling would strand it in transit with no record of where it went.",
    },
    {
      topic: "transfer", persona: "parts manager",
      question: "Can stock move directly from one truck to another?",
      answer: "Yes", answerType: "JUDGEMENT",
      wrongAnswers: ["No, it must go via the warehouse"],
      why: "both endpoints may be MOBILE -- only a transfer to the SAME location is refused"
        + (xfer.T06 ? `. ${xfer.T06.number} completed without touching warehouse availability` : "")
        + ".",
    },
    {
      topic: "transfer", persona: "service manager",
      question: `Did unblocking ${b.woNumber} make any other job worse?`,
      answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
      why: "the donor truck kept stock after giving up the shortage, and no other work order plans "
        + "this part. A recovery that strands a different job has moved the problem, not solved it.",
    },
  ];
}

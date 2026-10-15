"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNROUTED_OUTCOME = exports.ROUTING_DESTINATIONS = void 0;
exports.ruleMatches = ruleMatches;
exports.evaluateRouting = evaluateRouting;
exports.normalizeOutcome = normalizeOutcome;
// Email Connections + Inbound Work -- the ROUTING RULE model and its evaluator. Pure: no Firestore, no
// firebase import, no clock.
//
// THIS IS NOT A WORKFLOW ENGINE, and it must not become one. It answers one question -- "given this
// message and the mailbox it arrived in, how should the intake be classified and where does it go?" --
// with an ORDERED list of first-match-wins rules over a CLOSED set of conditions. There is no scripting,
// no user-supplied expression, no chaining, no action beyond setting the fields below. A rule that cannot
// be expressed in this shape is a product decision, not a missing engine.
//
// TAYLOR IS CONFIGURATION. No Taylor domain, mailbox address or vendor name appears in this file or in any
// other module under inboundWork/. The example in the documentation ("sender domain = Taylor Corporate AND
// mailbox = warranty => WARRANTY / SERVICE / WARRANTY_REVIEW / manual review") is authored as a rule
// DOCUMENT by an administrator, and lives in the sandbox fixtures.
const inboundWorkModel_1 = require("./inboundWorkModel");
/** Where accepted work is destined. SERVICE is the only destination with an operational surface in P1. */
exports.ROUTING_DESTINATIONS = ["SERVICE", "PARTS", "SALES", "OTHER"];
/**
 * The DEFAULT outcome when no rule matches. Deliberately conservative: a message nobody wrote a rule for
 * is a Service request that a person looks at. It is never silently classified as warranty, never assigned
 * an operating company, and never skips review -- fabricating a classification is how an unrouted vendor
 * email becomes a wrongly-billed warranty job.
 */
exports.UNROUTED_OUTCOME = Object.freeze({
    requestType: "SERVICE",
    destination: "SERVICE",
    manualReview: true,
});
const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");
function containsAll(haystack, terms) {
    if (!Array.isArray(terms) || terms.length === 0)
        return true;
    const hay = lower(haystack);
    return terms.every((t) => {
        const term = lower(t).trim();
        return term.length === 0 ? true : hay.includes(term);
    });
}
function ruleMatches(rule, subject) {
    if (!rule || rule.enabled === false)
        return false;
    const when = rule.when ?? {};
    if (when.mailboxId !== undefined && when.mailboxId !== subject.mailboxId)
        return false;
    if (when.senderAddress !== undefined && (0, inboundWorkModel_1.normalizeEmailAddress)(when.senderAddress) !== (0, inboundWorkModel_1.normalizeEmailAddress)(subject.sender)) {
        return false;
    }
    if (when.senderDomain !== undefined && lower(when.senderDomain).replace(/^@/, "") !== (0, inboundWorkModel_1.emailDomain)(subject.sender))
        return false;
    if (when.hasAttachments !== undefined && when.hasAttachments !== Boolean(subject.hasAttachments))
        return false;
    if (!containsAll(subject.subject, when.subjectContains))
        return false;
    if (!containsAll(subject.normalizedBody, when.bodyContains))
        return false;
    return true;
}
/** First match wins, in (order, id) sequence. Never mutates the input array. */
function evaluateRouting(rules, subject) {
    const ordered = [...(rules ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
    for (const rule of ordered) {
        if (ruleMatches(rule, subject)) {
            return { ruleId: rule.id, outcome: normalizeOutcome(rule.then), reason: "matched" };
        }
    }
    return { ruleId: null, outcome: { ...exports.UNROUTED_OUTCOME }, reason: "noRuleMatched" };
}
/**
 * A stored rule is administrator input, so its outcome is validated on the way OUT as well as in: an
 * unrecognised requestType/destination/priority is dropped rather than written onto an intake record.
 */
function normalizeOutcome(raw) {
    const r = (raw ?? {});
    const out = {};
    if ((0, inboundWorkModel_1.isInboundRequestType)(r.requestType))
        out.requestType = r.requestType;
    if (typeof r.destination === "string" && exports.ROUTING_DESTINATIONS.includes(r.destination)) {
        out.destination = r.destination;
    }
    if (typeof r.queue === "string" && r.queue.trim())
        out.queue = r.queue.trim().slice(0, 120);
    if (typeof r.operatingCompanyId === "string" && r.operatingCompanyId.trim()) {
        out.operatingCompanyId = r.operatingCompanyId.trim().slice(0, 120);
    }
    if (r.priority === 1 || r.priority === 2 || r.priority === 3 || r.priority === 4)
        out.priority = r.priority;
    if (typeof r.manualReview === "boolean")
        out.manualReview = r.manualReview;
    return out;
}
//# sourceMappingURL=inboundRouting.js.map
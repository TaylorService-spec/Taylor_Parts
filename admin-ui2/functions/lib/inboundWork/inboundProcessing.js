"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_PROCESSING_RESULT = exports.NO_CANDIDATE = void 0;
exports.extractProblemDescription = extractProblemDescription;
exports.processInboundMessageNatively = processInboundMessageNatively;
exports.normalizeProcessingResult = normalizeProcessingResult;
// Email Connections + Inbound Work -- the PROCESSING PROVIDER BOUNDARY.
//
// THE POINT OF THIS FILE. Base EOS must extract enough from an inbound message to review and accept it
// WITHOUT VDX, without Verenward Data Governance, and without any customer-selected iPaaS/ETL platform. It
// must also not become dependent on any of them later. Both properties come from one shape: every provider
// -- EOS_NATIVE, VDX, or a customer's own integration -- returns the SAME provider-neutral
// `InboundProcessingResult`, and the operational workflow above it (review, accept, decline, attach, Work
// Order creation) reads only that. There is no VDX payload type anywhere in the operational path, and no
// plugin framework either: a provider is a function from a normalized message to this result.
//
// WHAT A PROVIDER MAY NOT DO. It returns CANDIDATES and free text. It cannot choose the accepting user, the
// operating company authority, the intake status, or the Work Order that gets created; it cannot mutate a
// mastered Customer / Location / Contact / Equipment record; and nothing it returns is trusted as identity
// -- candidate ids are re-read and re-validated server-side at acceptance (inboundDecisionCommands.ts).
const inboundWorkModel_1 = require("./inboundWorkModel");
exports.NO_CANDIDATE = Object.freeze({ id: null, rawValue: "", confidence: "NONE", matchedOn: "" });
exports.EMPTY_PROCESSING_RESULT = Object.freeze({
    requestType: null,
    customerCandidate: exports.NO_CANDIDATE,
    locationCandidate: exports.NO_CANDIDATE,
    equipmentCandidate: exports.NO_CANDIDATE,
    externalReference: null,
    authorizationNumber: null,
    problemDescription: null,
    serialNumber: null,
    modelNumber: null,
    priority: null,
    warnings: [],
    providerMetadata: {},
});
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EOS NATIVE extraction. Labelled-field patterns only -- the shapes vendors and manufacturers actually
// write in a service or warranty email. No model, no inference, no external call: base EOS extraction has
// to work in an environment with no add-on and no network, and a pattern that is wrong is visibly wrong to
// the reviewer looking at the original message beside it.
// A SEPARATOR IS REQUIRED, and that is not a stylistic choice. The first version accepted a bare space
// between the label and the value, and "Warranty call - unit down" in a subject line then extracted "unit"
// as the case reference -- a wrong fact rendered beside the real message, which is worse than an honest
// blank. Each pattern now needs a punctuation separator or an explicit no./number/#/id marker, and the
// weakest labels (call, job) are gone entirely.
const AUTHORIZATION_PATTERN = /\b(?:authorization|authorisation|auth)\s*(?:[:#-]|no\.?|number|code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i;
const REFERENCE_PATTERN = /\b(?:reference|ref|case|ticket|claim)\s*(?:[:#-]|no\.?|number|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i;
const SERIAL_PATTERN = /\b(?:serial|s\/n|sn)\s*(?:[:#-]|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i;
const MODEL_PATTERN = /\b(?:model)\s*(?:[:#-]|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9.\/-]{2,})/i;
const PROBLEM_PATTERN = /\b(?:problem|issue|complaint|symptom|reported|description)\s*[:#-]\s*([^\n]{3,})/i;
const PRIORITY_PATTERN = /\b(?:priority)\s*[:#-]?\s*([1-4])\b/i;
const URGENT_PATTERN = /\b(?:urgent|emergency|down|not working|no cooling)\b/i;
function firstGroup(pattern, text) {
    const m = pattern.exec(text);
    const value = m ? (0, inboundWorkModel_1.boundedString)(m[1], inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH) : "";
    return value || null;
}
/**
 * The first sentence-or-line of the message that is not a greeting, a quoted reply or a signature -- what a
 * dispatcher would copy into `complaint` by hand. Returns null rather than inventing a description.
 */
function extractProblemDescription(normalizedBody) {
    const labelled = firstGroup(PROBLEM_PATTERN, normalizedBody);
    if (labelled)
        return labelled;
    for (const rawLine of String(normalizedBody ?? "").split("\n")) {
        const line = rawLine.trim();
        if (line.length < 12)
            continue;
        if (/^(hi|hello|dear|good (morning|afternoon|evening)|thanks|thank you|regards|sent from)\b/i.test(line))
            continue;
        // A quoted reply block ("> ..." / "On ... wrote:") is the PREVIOUS message, not this request.
        if (line.startsWith(">") || /\bwrote:\s*$/i.test(line))
            break;
        return (0, inboundWorkModel_1.boundedString)(line, 500);
    }
    return null;
}
/**
 * BASE EOS PROCESSING. Pure, deterministic, dependency-free: same message in, same result out, with no
 * database access. Record LOOKUP (turning an extracted serial or sender address into an EOS record id)
 * happens separately in inboundCandidateResolution.ts, because that needs Firestore and this must not.
 */
function processInboundMessageNatively(message, normalizedBody) {
    const haystack = `${message.subject}\n${normalizedBody}`;
    const authorizationNumber = firstGroup(AUTHORIZATION_PATTERN, haystack);
    const externalReference = firstGroup(REFERENCE_PATTERN, haystack);
    const serialNumber = firstGroup(SERIAL_PATTERN, haystack);
    const modelNumber = firstGroup(MODEL_PATTERN, haystack);
    const problemDescription = extractProblemDescription(normalizedBody);
    const priorityText = firstGroup(PRIORITY_PATTERN, haystack);
    const priority = priorityText ? Number(priorityText) : URGENT_PATTERN.test(haystack) ? 1 : null;
    const warnings = [];
    if (!problemDescription)
        warnings.push("NO_PROBLEM_DESCRIPTION");
    if (!serialNumber)
        warnings.push("NO_SERIAL_NUMBER");
    if (!authorizationNumber && !externalReference)
        warnings.push("NO_EXTERNAL_REFERENCE");
    return {
        // Native processing does not classify the request: that is the routing rules' job, and two components
        // guessing at the same field is how they come to disagree.
        requestType: null,
        customerCandidate: exports.NO_CANDIDATE,
        locationCandidate: exports.NO_CANDIDATE,
        equipmentCandidate: exports.NO_CANDIDATE,
        externalReference,
        authorizationNumber,
        problemDescription,
        serialNumber,
        modelNumber,
        priority,
        warnings,
        providerMetadata: { extractor: "eosNative", version: "1" },
    };
}
const asCandidate = (raw) => {
    if (!raw || typeof raw !== "object")
        return exports.NO_CANDIDATE;
    const c = raw;
    const id = (0, inboundWorkModel_1.boundedString)(c.id, 255) || null;
    return {
        id,
        rawValue: (0, inboundWorkModel_1.boundedString)(c.rawValue, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH),
        // A provider may CLAIM a confidence; only an id-bearing candidate is recorded as EXACT, and the id is
        // still re-validated at acceptance. This is the seam an external platform cannot talk its way past.
        confidence: id && c.confidence === "EXACT" ? "EXACT" : "NONE",
        matchedOn: (0, inboundWorkModel_1.boundedString)(c.matchedOn, 64),
    };
};
/**
 * Accept a result from ANY processing provider (VDX, a customer's iPaaS, a bespoke integration) into the
 * same bounded, provider-neutral contract. This is the whole extensibility mechanism: an external provider
 * satisfies the contract and the operational workflow -- including Work Order creation -- is unchanged.
 */
function normalizeProcessingResult(raw, provider) {
    const r = (raw ?? {});
    const priority = r.priority;
    const metadata = {};
    if (r.providerMetadata && typeof r.providerMetadata === "object") {
        for (const [k, v] of Object.entries(r.providerMetadata).slice(0, 20)) {
            metadata[(0, inboundWorkModel_1.boundedString)(k, 64)] = (0, inboundWorkModel_1.boundedString)(v, 255);
        }
    }
    metadata.provider = provider;
    return {
        requestType: typeof r.requestType === "string" && ["SERVICE", "WARRANTY", "INSTALL", "PM", "PARTS", "OTHER"].includes(r.requestType)
            ? r.requestType
            : null,
        customerCandidate: asCandidate(r.customerCandidate),
        locationCandidate: asCandidate(r.locationCandidate),
        equipmentCandidate: asCandidate(r.equipmentCandidate),
        externalReference: (0, inboundWorkModel_1.boundedString)(r.externalReference, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH) || null,
        authorizationNumber: (0, inboundWorkModel_1.boundedString)(r.authorizationNumber, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH) || null,
        problemDescription: (0, inboundWorkModel_1.boundedString)(r.problemDescription, 500) || null,
        serialNumber: (0, inboundWorkModel_1.boundedString)(r.serialNumber, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH) || null,
        modelNumber: (0, inboundWorkModel_1.boundedString)(r.modelNumber, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH) || null,
        priority: priority === 1 || priority === 2 || priority === 3 || priority === 4 ? priority : null,
        warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 20).map((w) => (0, inboundWorkModel_1.boundedString)(w, 120)).filter(Boolean),
        providerMetadata: metadata,
    };
}
//# sourceMappingURL=inboundProcessing.js.map
"use strict";
// EOS Data Import -- the canonical SERVICE HISTORY import contract.
//
// PORTABILITY BOUNDARY: no firebase-admin, no Firestore, no collection names.
//
// ============================ THE PROBLEM THIS ENTITY POSES ============================
//
// EOS already has Service History. It is a DERIVED view over Work Orders
// (reportCatalog.ts: serviceHistory, derivedFrom "fieldops_wos") -- not a stored thing, but
// what the Work Order record amounts to once the work is done. Every entry in it is the
// residue of a job that was created, scheduled, assigned, worked and closed inside EOS.
//
// A customer switching to EOS has years of service history that happened somewhere else.
// None of it went through any of that.
//
// ============================ WHY THIS IS NOT A WORK ORDER ============================
//
// The obvious implementation is to write historical Work Orders in a terminal state, and it
// is the wrong one. A Work Order in EOS is a lifecycle: transitionEngine.ts owns which state
// may follow which, dispatch reads from it, technicians are assigned through it, labour and
// parts attach to it. A record dropped into COMPLETED never had any of that, and every
// question the system can ask a Work Order -- who transitioned it, when was it scheduled,
// what was consumed -- has no honest answer for it.
//
// Worse, those fabricated records would be indistinguishable from real ones. A dispatcher's
// completion metrics, a technician's job count, an availability calculation, every future
// projection over Work Orders would silently include jobs that were never worked in EOS. The
// Owner's constraint for this checkpoint says it exactly: historical only, no fabricated
// lifecycle transitions.
//
// SO AN IMPORTED SERVICE RECORD IS ITS OWN KIND OF THING. It records that service happened,
// where, to what, and when -- and it is honest about being a record of something that
// happened elsewhere. It is not a Work Order, is never transitioned, and no operational
// projection reads it today.
//
// ============================ THE SEAM THIS LEAVES OPEN ============================
//
// EOS's Service History view therefore does NOT yet include imported records: it reads Work
// Orders, and this changes nothing about it. Whether that view should become a union of both
// sources is a real product decision -- it changes what "service history" means and what
// every report over it counts -- and it is deliberately NOT made here. Recording the history
// faithfully first, and deciding what reads it second, is the order that keeps the decision
// open. Making the reverse choice would mean writing records shaped to fit a view.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_HISTORY_IMPORT_CONTRACT = exports.SERVICE_HISTORY_REQUIRED_FIELDS = exports.SERVICE_HISTORY_CANONICAL_FIELDS = exports.SERVICE_HISTORY_REFERENCES = exports.SERVICE_HISTORY_IMPORT_CONTRACT_VERSION = void 0;
exports.normalizeServiceHistoryRow = normalizeServiceHistoryRow;
exports.serviceHistoryContextFindings = serviceHistoryContextFindings;
const entityContract_js_1 = require("./entityContract.js");
const partImportContract_js_1 = require("./partImportContract.js");
exports.SERVICE_HISTORY_IMPORT_CONTRACT_VERSION = 1;
/** The reference names a service record depends on. */
exports.SERVICE_HISTORY_REFERENCES = Object.freeze({ CUSTOMER: "customer" });
exports.SERVICE_HISTORY_CANONICAL_FIELDS = Object.freeze([
    Object.freeze({
        field: "customerName",
        label: "Customer Name",
        required: true,
        description: "The customer the service was performed for. Must already exist in EOS.",
        synonyms: ["customername", "customer name", "customer", "accountname", "account name", "account", "client"],
    }),
    Object.freeze({
        field: "serviceDate",
        label: "Service Date",
        required: true,
        description: "The date the work was performed, as YYYY-MM-DD. This is when it happened, not when it was recorded.",
        synonyms: [
            "servicedate", "service date", "date", "completeddate", "completed date", "completed",
            "workdate", "work date", "visitdate", "datecompleted", "closeddate",
        ],
    }),
    Object.freeze({
        field: "summary",
        label: "Work Performed",
        required: true,
        description: "What was done. Free text, carried across exactly as the source system holds it.",
        synonyms: [
            "summary", "workperformed", "work performed", "description", "details", "notes",
            "servicedescription", "resolution", "problem", "complaint", "narrative",
        ],
    }),
    Object.freeze({
        field: "externalReference",
        label: "Source Reference",
        required: false,
        description: "The old system's number for this job. Kept so the record stays traceable to where it came from.",
        synonyms: [
            "externalreference", "external reference", "reference", "ref", "workorder", "workordernumber",
            "wonumber", "wo", "ticket", "ticketnumber", "invoicenumber", "jobnumber", "job number", "callnumber",
        ],
    }),
    Object.freeze({
        field: "equipmentSerialNumber",
        label: "Equipment Serial Number",
        required: false,
        description: "The machine that was serviced, if the record names one. Recorded as written; never resolved to a link.",
        synonyms: ["serialnumber", "serial number", "serial", "sn", "equipmentserial", "unitserial", "assetserial"],
    }),
    Object.freeze({
        field: "technicianName",
        label: "Technician",
        required: false,
        description: "Who did the work, as the old system recorded it. A NAME, not a link to an EOS employee.",
        synonyms: ["technician", "techniciannname", "technician name", "tech", "techname", "performedby", "servicedby"],
    }),
    Object.freeze({
        field: "locationName",
        label: "Location",
        required: false,
        description: "Where the work happened, as text. Not resolved to a governed Location record.",
        synonyms: ["location", "locationname", "location name", "site", "sitename", "address", "branch", "store"],
    }),
]);
exports.SERVICE_HISTORY_REQUIRED_FIELDS = Object.freeze(exports.SERVICE_HISTORY_CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.field));
const MAX_SUMMARY_LENGTH = 5000;
const MAX_TEXT_LENGTH = 500;
function err(field, code, message) {
    return Object.freeze({ severity: "ERROR", field, code, message });
}
function warn(field, code, message) {
    return Object.freeze({ severity: "WARNING", field, code, message });
}
/** YYYY-MM-DD, and nothing else -- the same rule and the same reason as Equipment's dates. */
function normalizeServiceDate(value, findings, today) {
    const raw = (0, partImportContract_js_1.normalizeText)(value);
    if (!raw) {
        findings.push(err("serviceDate", "REQUIRED", "Service Date is required. History without a date is not history."));
        return undefined;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        findings.push(err("serviceDate", "AMBIGUOUS_DATE", `"${raw}" is not a YYYY-MM-DD date. Reformat the column; a guessed date is worse than none.`));
        return undefined;
    }
    const [y, m, d] = raw.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        findings.push(err("serviceDate", "INVALID_DATE", `"${raw}" is not a real date.`));
        return undefined;
    }
    if (raw > today) {
        // THE DEFINING CHECK FOR THIS ENTITY. A future date is not history. It is either a typo or
        // an attempt to schedule work through the import path -- and scheduling work is what Work
        // Orders and dispatch are for, with a lifecycle this record deliberately does not have.
        findings.push(err("serviceDate", "NOT_HISTORICAL", `"${raw}" is in the future. This imports service that has already happened; work still to be done is a Work Order, not history.`));
        return undefined;
    }
    return raw;
}
function normalizeServiceHistoryRow(values, today = new Date().toISOString().slice(0, 10)) {
    const findings = [];
    const customerName = (0, partImportContract_js_1.normalizeText)(values.customerName);
    if (!customerName) {
        findings.push(err("customerName", "REQUIRED", "Customer Name is required. Service happened FOR somebody."));
    }
    const serviceDate = normalizeServiceDate(values.serviceDate, findings, today);
    const summary = (0, partImportContract_js_1.normalizeText)(values.summary);
    if (!summary) {
        // A record saying only that somebody visited on a date is not history anybody can use;
        // it is a row that would sit in the system forever answering no question.
        findings.push(err("summary", "REQUIRED", "Work Performed is required. A date with no description records nothing useful."));
    }
    else if (summary.length > MAX_SUMMARY_LENGTH) {
        findings.push(err("summary", "TOO_LONG", `Work Performed exceeds ${MAX_SUMMARY_LENGTH} characters.`));
    }
    const text = (field, value) => {
        const v = (0, partImportContract_js_1.normalizeText)(value);
        if (v === undefined)
            return undefined;
        if (v.length > MAX_TEXT_LENGTH) {
            findings.push(err(field, "TOO_LONG", `${field} exceeds ${MAX_TEXT_LENGTH} characters.`));
            return undefined;
        }
        return v;
    };
    const externalReference = text("externalReference", values.externalReference);
    const equipmentSerialNumber = text("equipmentSerialNumber", values.equipmentSerialNumber);
    const technicianName = text("technicianName", values.technicianName);
    const locationName = text("locationName", values.locationName);
    if (!externalReference) {
        // A warning because the record is still worth having, and a real one because without the
        // source system's number a person auditing this later cannot go back and check it.
        findings.push(warn("externalReference", "NO_SOURCE_REFERENCE", "No reference from the source system. The record imports, but it cannot be traced back to the job it came from."));
    }
    if (findings.some((f) => f.severity === "ERROR") || !customerName || !serviceDate || !summary) {
        return { draft: null, findings: Object.freeze(findings) };
    }
    return {
        draft: Object.freeze({
            customerName,
            serviceDate,
            summary,
            externalReference,
            equipmentSerialNumber,
            technicianName,
            locationName,
        }),
        findings: Object.freeze(findings),
    };
}
/**
 * The customer must exist. Nothing else is resolved, and that is the design.
 *
 * The technician is a NAME and stays a name: the person who did the work in 2019 may not be
 * an EOS employee, may have left, or may share a name with somebody who is. Linking a
 * historical record to a current employee on a name match would attribute somebody else's
 * work to a real person, in a record that looks authoritative.
 *
 * The equipment serial is recorded AS WRITTEN rather than linked for the same reason plus one
 * more: the machine may have been replaced, and a link would attach the old machine's history
 * to the new one.
 */
function serviceHistoryContextFindings(draft, context) {
    const customers = context.references?.[exports.SERVICE_HISTORY_REFERENCES.CUSTOMER];
    const customerName = String(draft.customerName ?? "");
    if (!customers || !customers.has((0, entityContract_js_1.naturalIdentityKey)(customerName))) {
        return Object.freeze([
            err("customerName", "CUSTOMER_NOT_FOUND", `No customer named "${customerName}" exists in EOS. Import the customers first, or correct the name.`),
        ]);
    }
    return Object.freeze([]);
}
/**
 * IDENTITY IS THE SOURCE REFERENCE WHERE THERE IS ONE, and the (customer, date, summary)
 * otherwise.
 *
 * A service record has no natural key of its own -- one customer can genuinely have two
 * visits on one day. The source system's job number is the only field that says "this is that
 * job", so it is used when present. Without it, the composite is the best available answer
 * and it is deliberately narrow: it will call two identical descriptions on one day at one
 * customer a duplicate, which is the safe direction. Two genuinely distinct visits described
 * identically are indistinguishable in the file too.
 */
exports.SERVICE_HISTORY_IMPORT_CONTRACT = (0, entityContract_js_1.registerEntityContract)({
    entityType: "SERVICE_HISTORY",
    label: "Service Record",
    canonicalFields: exports.SERVICE_HISTORY_CANONICAL_FIELDS,
    requiredFields: exports.SERVICE_HISTORY_REQUIRED_FIELDS,
    identityField: "externalReference",
    identityLabel: "Source Reference",
    referenceFields: Object.freeze([
        Object.freeze({ reference: exports.SERVICE_HISTORY_REFERENCES.CUSTOMER, field: "customerName" }),
    ]),
    normalizeRow: (values) => normalizeServiceHistoryRow(values),
    contextFindings: serviceHistoryContextFindings,
    identityKey: (draft) => {
        const ref = (0, entityContract_js_1.naturalIdentityKey)(String(draft.externalReference ?? ""));
        if (ref)
            return `REF ${ref}`;
        return [
            (0, entityContract_js_1.naturalIdentityKey)(String(draft.customerName ?? "")),
            String(draft.serviceDate ?? ""),
            (0, entityContract_js_1.naturalIdentityKey)(String(draft.summary ?? "")).slice(0, 200),
        ].join(" | ");
    },
});
//# sourceMappingURL=serviceHistoryImportContract.js.map
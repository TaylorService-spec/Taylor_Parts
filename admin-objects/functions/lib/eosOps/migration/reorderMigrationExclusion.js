"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReorderExclusionError = exports.CERTIFICATION_LIVE_PROOF_PART_ID = exports.REORDER_EXCLUSION_VERSION = exports.REORDER_EXCLUSION_FORMAT = void 0;
exports.buildReorderExclusionManifest = buildReorderExclusionManifest;
exports.renderReorderExclusionManifest = renderReorderExclusionManifest;
exports.assertDeclaredExclusionManifest = assertDeclaredExclusionManifest;
exports.applyReorderExclusion = applyReorderExclusion;
// THE REORDER MIGRATION EXCLUSION -- Controller ruling DQ-032 (2026-09-28).
//
// The eight SBX-SCN-001 Reorder records are repository-authored scenario fixtures, not legacy business records. The
// earlier plan retired them by DELETING them from Firestore; DQ-032 reverses that: the zero-new-Firebase-mutation
// direction wins, the Firestore source is left exactly as it is, and the COPY excludes them instead. They disappear
// with the final Firebase retirement.
//
// What this module guarantees, and what the cutover evidence therefore proves:
//
//   * EXACTLY THE DECLARED EIGHT. The manifest is derived from REORDER_SCENARIO_FIXTURES, the same declaration the
//     fixture tooling uses. An operator-supplied manifest is accepted only if it is byte-identical to the derived one
//     (and matches its .sha256 sidecar), so it cannot widen or narrow the exclusion.
//   * AN EXCLUDED ID MUST BE THE FIXTURE. A snapshot record occupying a declared id is excluded only when its facts
//     match the declaration (classifyCandidate: CONFIRMED_SYNTHETIC). A diverged or unmarked occupant REFUSES the whole
//     run -- it may be real data wearing a fixture's id, and excluding it would silently drop it.
//   * NOTHING ELSE IS EXCLUDED. The proof reports, per collection, source = retained + excluded, and lists every
//     excluded id; retained ids are the source ids minus exactly those.
//   * NO DANGLING REFERENCE. A retained record that points at an excluded one (a Reorder naming an excluded purchase
//     order, a purchase order or void naming an excluded Reorder or purchase order) refuses: the exclusion would
//     otherwise change the meaning of a record that IS copied.
//
// Pure: no database, no Firestore, no file system.
const reorderScenarioFixtures_js_1 = require("../../sandboxFixtures/reorderScenarioFixtures.js");
const reorderSnapshot_js_1 = require("./reorderSnapshot.js");
exports.REORDER_EXCLUSION_FORMAT = "EOS_REORDER_MIGRATION_EXCLUSION";
exports.REORDER_EXCLUSION_VERSION = 2;
/** The certification part the Catalog census excludes (CERTIFICATION_FIXTURE_EXCLUDED); live-proof records name it. */
exports.CERTIFICATION_LIVE_PROOF_PART_ID = "CW-P-0000";
// Exact source ids, reconciled from the FP-0 snapshot (2026-09-30). Mutually exclusive with the fixtures and the hold.
const CERTIFICATION_LIVE_PROOF_REQUEST_IDS = Object.freeze([
    "8qKjYorWjvNyYRH53Uzy", "KuYv3Ld0pFSGBz3bHvpc", "P1Ia7fpUTKPq3RloYEvF", "Sz8QPa815EgkmvmObQ1K", "YqD07rXiAE3jLoHf4q6x",
    "ggJNjr0LsxEEn7Hwc2zX", "kLbfmkzNcUGYITlWzFGG", "veqnZP7HHnaa09PgXTqe", "ywq7UpdczU1KZ6Z86ejS",
]);
const CERTIFICATION_LIVE_PROOF_PURCHASE_ORDER_IDS = Object.freeze(["Sz8QPa815EgkmvmObQ1K"]);
const LEGACY_INCOMPLETE_REQUEST_IDS = Object.freeze(["eA7o3t8DyUXmtg8MCKjT"]);
class ReorderExclusionError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReorderExclusionError";
    }
}
exports.ReorderExclusionError = ReorderExclusionError;
const key = (collection, id) => `${collection}|${id}`;
const byEntry = (a, b) => (key(a.collection, a.id) < key(b.collection, b.id) ? -1 : key(a.collection, a.id) > key(b.collection, b.id) ? 1 : 0);
/** The one manifest the repository declares. Deterministic: same bytes every time. */
function buildReorderExclusionManifest() {
    const entries = reorderScenarioFixtures_js_1.REORDER_SCENARIO_FIXTURES
        .map((f) => Object.freeze({ collection: f.collection, id: f.id }))
        .sort(byEntry);
    return Object.freeze({
        format: exports.REORDER_EXCLUSION_FORMAT,
        version: exports.REORDER_EXCLUSION_VERSION,
        ruling: "DQ-032",
        scenarioId: reorderScenarioFixtures_js_1.SCENARIO_ID,
        reason: "Repository-authored SBX-SCN-001 scenario fixtures: excluded from the governed COPY, left unchanged in "
            + "Firestore, removed only by the final Firebase retirement.",
        count: entries.length,
        entries: Object.freeze(entries),
        certificationLiveProof: section("CERTIFICATION_LIVE_PROOF", "EXCLUDED", "Controller ruling 2026-09-30 (CW-P-0000 / Reorder migration)", "Decision #155 / workstream 2C / R-34 live-proof evidence on certification part CW-P-0000, which the Catalog census "
            + "excludes as a certification fixture. Excluded from the PostgreSQL business-data migration; retained unchanged "
            + "in Firestore as historical evidence until the final Firebase retirement.", [...CERTIFICATION_LIVE_PROOF_REQUEST_IDS.map((id) => ({ collection: "reorder_requests", id })),
            ...CERTIFICATION_LIVE_PROOF_PURCHASE_ORDER_IDS.map((id) => ({ collection: "reorder_purchase_orders", id }))]),
        holds: section("LEGACY_INCOMPLETE_OPERATING_CONTEXT", "HOLD", "Controller ruling (LEGACY_INCOMPLETE_OPERATING_CONTEXT)", "The source Reorder states no warehouse and no operating company. It is HELD: not copied, its company is never "
            + "inferred, and the source is never mutated. It is not a fixture exclusion.", LEGACY_INCOMPLETE_REQUEST_IDS.map((id) => ({ collection: "reorder_requests", id }))),
    });
}
function section(classification, disposition, ruling, reason, list) {
    const entries = [...list].sort(byEntry).map((e) => Object.freeze({ collection: e.collection, id: e.id }));
    return Object.freeze({ classification, disposition, ruling, reason, count: entries.length, entries: Object.freeze(entries) });
}
/** The canonical file text of the manifest (what is committed and checksummed). */
function renderReorderExclusionManifest() {
    return JSON.stringify(buildReorderExclusionManifest(), null, 2) + "\n";
}
/** Accept an operator-supplied manifest only if it is exactly the declared one. */
function assertDeclaredExclusionManifest(text) {
    if (text !== renderReorderExclusionManifest()) {
        throw new ReorderExclusionError("the exclusion manifest is not the repository's declared DQ-032 manifest; it can neither widen nor narrow the exclusion.");
    }
    return buildReorderExclusionManifest();
}
const REFERENCE_FIELDS = {
    reorder_requests: [["purchaseOrderId", "reorder_purchase_orders"]],
    reorder_purchase_orders: [["reorderRequestId", "reorder_requests"]],
    reorder_purchase_order_voids: [["reorderRequestId", "reorder_requests"], ["purchaseOrderId", "reorder_purchase_orders"]],
};
/**
 * Remove exactly the declared fixtures from a parsed snapshot. Returns the filtered snapshot (the ONLY input the
 * copy and verify stages then see) and the proof. Refuses on a diverged occupant or a dangling reference.
 */
function applyReorderExclusion(snapshot, manifest, sha256Hex) {
    const declared = new Set(manifest.entries.map((e) => key(e.collection, e.id)));
    const liveProof = new Set(manifest.certificationLiveProof.entries.map((e) => key(e.collection, e.id)));
    const holdIds = new Set(manifest.holds.entries.map((e) => key(e.collection, e.id)));
    const liveProofRequests = new Set(manifest.certificationLiveProof.entries
        .filter((e) => e.collection === "reorder_requests").map((e) => e.id));
    const liveRemoved = [];
    const heldRemoved = [];
    const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    const excluded = [];
    const refusals = [];
    const collections = {};
    const counts = {};
    for (const name of reorderSnapshot_js_1.REORDER_SNAPSHOT_COLLECTIONS) {
        const source = snapshot.collections[name];
        const retained = [];
        let heldHere = 0;
        for (const doc of source) {
            const k = key(name, doc.id);
            if (liveProof.has(k)) {
                // It must still BE the live-proof record: it names the certification part (and a PO belongs to a live-proof request).
                const partOk = doc.data.partId === exports.CERTIFICATION_LIVE_PROOF_PART_ID;
                const lineageOk = name !== "reorder_purchase_orders" || liveProofRequests.has(String(doc.data.reorderRequestId));
                if (!partOk || !lineageOk) {
                    refusals.push(`${name}/${doc.id} is declared CERTIFICATION_LIVE_PROOF but no longer matches it (part/lineage diverged)`);
                    continue;
                }
                liveRemoved.push(Object.freeze({ collection: name, id: doc.id }));
                continue;
            }
            if (holdIds.has(k)) {
                // It must still lack its operating context; if it gained one, it needs a fresh ruling, not a silent hold.
                if (!blank(doc.data.warehouseId) || !blank(doc.data.operatingCompanyId)) {
                    refusals.push(`${name}/${doc.id} is HELD as LEGACY_INCOMPLETE_OPERATING_CONTEXT but now states an operating context`);
                    continue;
                }
                heldRemoved.push(Object.freeze({ collection: name, id: doc.id }));
                heldHere += 1;
                continue;
            }
            if (!declared.has(k)) {
                retained.push(doc);
                continue;
            }
            const c = (0, reorderScenarioFixtures_js_1.classifyCandidate)({ collection: name, id: doc.id, data: doc.data }, sha256Hex);
            if (c.classification !== "CONFIRMED_SYNTHETIC") {
                refusals.push(`${name}/${doc.id} occupies a declared fixture id but is ${c.classification}`);
                continue;
            }
            excluded.push(Object.freeze({ collection: name, id: doc.id, fingerprint: c.fingerprint }));
        }
        collections[name] = Object.freeze(retained);
        counts[name] = { source: source.length, excluded: source.length - retained.length - heldHere, held: heldHere, retained: retained.length };
    }
    const excludedKeys = new Set([...excluded, ...liveRemoved, ...heldRemoved].map((e) => key(e.collection, e.id)));
    for (const name of reorderSnapshot_js_1.REORDER_SNAPSHOT_COLLECTIONS) {
        for (const doc of collections[name]) {
            for (const [field, target] of REFERENCE_FIELDS[name]) {
                const ref = doc.data[field];
                if (typeof ref === "string" && excludedKeys.has(key(target, ref))) {
                    refusals.push(`${name}/${doc.id} is copied but its ${field} names the excluded ${target}/${ref}`);
                }
            }
        }
    }
    if (refusals.length > 0) {
        throw new ReorderExclusionError(`exclusion refused: ${refusals.join("; ")}`);
    }
    const present = new Set(excluded.map((e) => key(e.collection, e.id)));
    const absent = manifest.entries.filter((e) => !present.has(key(e.collection, e.id)));
    const totalRemoved = reorderSnapshot_js_1.REORDER_SNAPSHOT_COLLECTIONS.reduce((n, c) => n + counts[c].excluded + counts[c].held, 0);
    const liveKeys = new Set(liveRemoved.map((e) => key(e.collection, e.id)));
    const heldKeys = new Set(heldRemoved.map((e) => key(e.collection, e.id)));
    const filtered = Object.freeze({
        source: snapshot.source,
        counts: Object.freeze(Object.fromEntries(reorderSnapshot_js_1.REORDER_SNAPSHOT_COLLECTIONS.map((c) => [c, counts[c].retained]))),
        collections: Object.freeze(collections),
    });
    return {
        snapshot: filtered,
        proof: Object.freeze({
            ruling: "DQ-032",
            manifestCount: manifest.count,
            counts: Object.freeze(counts),
            excluded: Object.freeze(excluded.sort(byEntry)),
            absent: Object.freeze(absent),
            onlyDeclaredFixturesExcluded: totalRemoved === excluded.length + liveRemoved.length + heldRemoved.length,
            certificationLiveProof: Object.freeze({
                classification: "CERTIFICATION_LIVE_PROOF", reason: manifest.certificationLiveProof.reason,
                excluded: Object.freeze(liveRemoved.sort(byEntry)),
                absent: Object.freeze(manifest.certificationLiveProof.entries.filter((e) => !liveKeys.has(key(e.collection, e.id)))),
            }),
            held: Object.freeze({
                classification: "LEGACY_INCOMPLETE_OPERATING_CONTEXT", reason: manifest.holds.reason,
                held: Object.freeze(heldRemoved.sort(byEntry)),
                absent: Object.freeze(manifest.holds.entries.filter((e) => !heldKeys.has(key(e.collection, e.id)))),
            }),
        }),
    };
}
//# sourceMappingURL=reorderMigrationExclusion.js.map
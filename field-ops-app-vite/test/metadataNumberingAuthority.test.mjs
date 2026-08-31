// RCV-G4 — metadata must describe the numbering authority that ACTUALLY EXISTS.
//
// THE DEFECT THIS PINS. Two entity definitions claimed, in prose a reader would reasonably trust,
// that no business-number allocator was "implemented anywhere". Both allocators existed. Metadata
// that says an authority does not exist is read as evidence that it does not exist, and the next
// reader builds a second one — which is why this is a governance defect and not a typo.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It does NOT pin sentences. Grepping the definitions for the old wording would fail the moment
// someone paraphrased it, and would also trip over the corrected headers, which QUOTE the false
// claim in order to record that it was corrected.
//
// Instead it cross-checks the documentation against the code it describes: each definition must NAME
// the module its allocator lives in, and this test RESOLVES that module and proves the export is
// really there. Reinstating "no allocator is implemented anywhere" necessarily removes the citation,
// so the test fails. Moving the allocator without updating the metadata also fails. Both are the
// desired behaviour.
//
// The two entities are in genuinely DIFFERENT states and are asserted differently — the transfer
// allocator is wired into its create command, the reorder one is not called by anything. Flattening
// them into one claim would have introduced a fresh inaccuracy while fixing an old one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const read = (p) => readFileSync(resolve(REPO, p), "utf8");

const DEFINITIONS = {
  reorderRequest: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js",
  transferOrder: "field-ops-app-vite/src/metadata/definitions/transferOrder.js",
};

/** The allocator each definition is REQUIRED to cite, and the export that must exist there. */
const ALLOCATORS = {
  reorderRequest: {
    module: "functions/src/reorderRequest/reorderRequestNumbering.ts",
    fn: "allocateReorderRequestNumber",
    field: "reorderRequestNumber",
    prefix: "RR-",
  },
  transferOrder: {
    module: "functions/src/inventoryTransfer/transferOrderNumbering.ts",
    fn: "allocateTransferOrderNumber",
    field: "transferOrderNumber",
    prefix: "TO-",
  },
};

// =========================== the authority genuinely exists ===========================

test("both business-number allocators exist in the repository", () => {
  // The fact the metadata was wrong about. Asserted against the source, so this test knows what
  // "exists" means rather than trusting a previous measurement.
  for (const [entity, a] of Object.entries(ALLOCATORS)) {
    const src = read(a.module);
    assert.match(src, new RegExp(`export async function ${a.fn}\\b`), `${entity}: ${a.fn} must be exported from ${a.module}`);
  }
});

test("each definition CITES the module its allocator actually lives in", () => {
  // The cross-check that makes this falsifiable without pinning prose. A definition that claims no
  // allocator exists cannot also name the file it lives in, so the false claim cannot come back
  // while this passes.
  for (const [entity, a] of Object.entries(ALLOCATORS)) {
    const doc = read(DEFINITIONS[entity]);
    assert.ok(doc.includes(a.fn), `${entity} metadata must name ${a.fn}`);
    assert.ok(doc.includes(a.module), `${entity} metadata must cite ${a.module}, the module that really holds it`);
  }
});

// =========================== the two entities are in different states ===========================

test("the transfer allocator is WIRED, and the metadata says so", () => {
  // Measured: createTransferOrder calls it inside its transaction and serializes the result.
  const command = read("functions/src/inventoryTransfer/transferOrderCommand.ts");
  assert.match(command, /await allocateTransferOrderNumber\(/, "createTransferOrder must call the allocator");
  assert.match(read(DEFINITIONS.transferOrder), /createTransferOrder/, "the metadata must name the caller that makes numbering live");
});

test("the reorder allocator is NOT wired, and the metadata says THAT", () => {
  // Also measured, and the reason the two corrections differ: nothing allocates a reorder number, so
  // no reorder_requests document carries one. Saying "numbering is live" here would have been a new
  // inaccuracy introduced while fixing an old one.
  //
  // WHEN THIS FAILS BECAUSE SOMEONE WIRED IT: update the metadata, not this test. The invariant is
  // that the documentation matches the authority, in whichever direction it has moved.
  const productionCallers = ["functions/src/reorderRequest/reorderCallables.ts", "functions/src/reorderRequest/reorderCommands.ts"];
  for (const path of productionCallers) {
    assert.ok(!read(path).includes("allocateReorderRequestNumber"), `${path} does not allocate a number today`);
  }
  assert.match(read(DEFINITIONS.reorderRequest), /NOTHING CALLS IT/, "the metadata must state that the allocator is unwired");
});

// =========================== the invariant the ruling names ===========================

test("the document id is NEVER the business-number fallback", () => {
  // The second half of the invariant, and the one with a user-visible consequence. Both definitions
  // must keep the refusal, and neither may introduce a documentId fallback for the reference field.
  for (const [entity, a] of Object.entries(ALLOCATORS)) {
    const doc = read(DEFINITIONS[entity]);
    assert.match(doc, /must not fall\s+"?\s*\+?\s*"?back to the Firestore document id/, `${entity} must keep the no-documentId-fallback rule`);
    // identity is the business reference, not the id.
    assert.match(doc, new RegExp(`referenceField:\\s*"${a.field}"`), `${entity} identity.referenceField must be ${a.field}`);
    assert.doesNotMatch(doc, /nameField:\s*"(id|documentId)"/, `${entity} must not promote the document id to identity`);
  }
});

test("the allocators format a governed business number, not a document id", () => {
  // Why the fallback is forbidden at all: these are a different KIND of identifier. A prefix-and-year
  // sequence is a business reference people quote; a Firestore id is an opaque storage key.
  for (const a of Object.values(ALLOCATORS)) {
    const src = read(a.module);
    assert.ok(src.includes(`\`${a.prefix}`), `${a.module} must format the ${a.prefix}YYYY-###### reference`);
    assert.match(src, /padStart\(6, "0"\)/, "six-digit zero-padded sequence");
    assert.doesNotMatch(src, /\.doc\(\)\.id|documentId/, "a business number is never derived from a document id");
  }
});

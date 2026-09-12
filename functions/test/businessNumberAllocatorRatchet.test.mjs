// P3-0B RATCHET -- a new business-number allocator cannot ship without collision defence.
//
// The defect this guards against was SYSTEMIC, not local: eight allocators had independently written
// the same line, `snap.exists ? counter.sequence + 1 : 1`, and all eight therefore reissued their
// family's first number whenever the counter document was lost. The fix was to give them ONE shared
// core (functions/src/numbering/businessNumber.ts) instead of eight copies. That consolidation only
// stays true if the ninth allocator is forced to use it too -- which is what this file does, by
// reading the allocator sources and refusing anything that reintroduces the old shape.
//
// This is a SOURCE-LEVEL test on purpose. A behavioural test can only cover allocators it knows about;
// the whole failure mode here is a new allocator nobody added a test for.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}
const rel = (p) => path.relative(path.resolve(SRC, ".."), p).replace(/\\/g, "/");

/**
 * An allocator is any source file that builds a reference into the shared `counters` collection --
 * i.e. `.collection(COUNTERS_COLLECTION)`. That is deliberately structural rather than name-based: an
 * allocator called something other than `*Numbering.ts` is exactly the case a name-based rule misses.
 * Files that merely DECLARE or mention the constant (src/constants/collections.ts) or that plan an
 * offline backfill without touching a counter are not allocators and do not match.
 */
function findAllocatorSources() {
  return walk(SRC).filter((f) => /\.collection\(COUNTERS_COLLECTION\)/.test(readFileSync(f, "utf8")));
}

// The census as of P3-0B. Listed explicitly so that ADDING an allocator fails this test until the
// author has come here and thought about collision defence -- that is the entire point of the ratchet.
const KNOWN_ALLOCATORS = [
  "src/finance/invoiceNumbering.ts",
  "src/inventoryReceiving/receivingOrderNumbering.ts",
  "src/inventoryTransfer/transferOrderNumbering.ts",
  "src/opportunity/opportunityNumbering.ts",
  "src/reorderRequest/reorderRequestNumbering.ts",
  "src/salesAgreement/salesAgreementNumbering.ts",
  "src/salesOrder/salesOrderNumbering.ts",
  "src/woNumbering.ts",
];

test("the set of business-number allocators is exactly the censused set", () => {
  const found = findAllocatorSources().map(rel).sort();
  assert.deepEqual(
    found,
    [...KNOWN_ALLOCATORS].sort(),
    "A file that reads the `counters` collection was added or removed. If you are adding a business-number " +
      "allocator: route it through functions/src/numbering/businessNumber.ts (allocateBusinessNumber), add it " +
      "to KNOWN_ALLOCATORS here, and register its family in functions/scripts/backfillOperationalNumbering.mjs " +
      "so legacy records and claim seeding are covered too."
  );
});

test("every allocator derives its number through the shared core", () => {
  for (const file of findAllocatorSources()) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /from "[^"]*numbering\/businessNumber(\.js)?"/,
      `${rel(file)} does not import the shared allocation core. Every business number must come from ` +
        `allocateBusinessNumber() in functions/src/numbering/businessNumber.ts -- it is what claims the ` +
        `number, and the claim is what makes a duplicate impossible when the counter is lost.`
    );
    assert.match(
      src,
      /allocateBusinessNumber\(/,
      `${rel(file)} imports the core but never calls allocateBusinessNumber().`
    );
  }
});

test("no allocator reintroduces the unguarded counter arithmetic", () => {
  // The exact shape of the original defect, and the near-misses that behave identically.
  const BANNED = [
    { re: /\.exists\s*\?[^;]*\.sequence\s*\+\s*1\s*:\s*1/s, why: "`snap.exists ? counter.sequence + 1 : 1` restarts at 1 when the counter is lost, reissuing a live number" },
    { re: /\.sequence\s*\?\?\s*0\s*\)\s*\+\s*1/s, why: "`(sequence ?? 0) + 1` silently treats a corrupt counter as zero" },
  ];
  for (const file of findAllocatorSources()) {
    const src = readFileSync(file, "utf8");
    // Comments legitimately quote the old line to explain the defect; strip them before matching.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const { re, why } of BANNED) {
      assert.doesNotMatch(code, re, `${rel(file)}: ${why}`);
    }
  }
});

test("no allocator writes its counter directly -- writes come from the core's pendingWrites", () => {
  for (const file of findAllocatorSources()) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /\btx\.set\(|\btxn\.set\(/,
      `${rel(file)} writes the counter itself. A direct counter write bypasses the claim, which is the ` +
        `duplicate barrier. Return/flush the core's pendingWrites instead.`
    );
  }
});

test("the collision-aware backfill tool covers every per-year allocator family", () => {
  const tool = readFileSync(path.join(SCRIPTS, "backfillOperationalNumbering.mjs"), "utf8");
  // Every family whose counter is keyed per YEAR. Invoice is keyed per COMPANY and does not fit this
  // tool's (family, year) shape -- an open Owner question, deliberately not forced in here.
  for (const family of [
    "workOrder",
    "opportunity",
    "salesOrder",
    "salesAgreement",
    "transferOrder",
    "receivingOrder",
    "reorderRequest",
  ]) {
    assert.match(
      tool,
      new RegExp(`^\\s{2}${family}:\\s*\\{`, "m"),
      `functions/scripts/backfillOperationalNumbering.mjs has no '${family}' family. Legacy records in that ` +
        `family can never be numbered, and its existing numbers are never seeded into the claim ledger.`
    );
  }
  assert.match(
    tool,
    /BUSINESS_NUMBER_CLAIMS_COLLECTION/,
    "the backfill tool must seed the claim ledger for every number it assigns, or a backfilled number is " +
      "invisible to the live allocator's probe and can be handed out a second time"
  );
});

test("the claim ledger is closed to clients in firestore.rules", () => {
  const rules = readFileSync(path.resolve(SRC, "../../firestore.rules"), "utf8");
  const block = /match \/business_number_claims\/\{[^}]*\} \{([\s\S]*?)\}/.exec(rules);
  assert.ok(block, "firestore.rules has no match block for business_number_claims");
  assert.match(block[1], /allow read: if false;/, "claims must not be readable by clients");
  assert.match(block[1], /allow create, update, delete: if false;/, "claims must not be writable by clients");
});

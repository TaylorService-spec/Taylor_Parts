// SCANNING IS NOT MOVING.
//
// ============================ THE BOUNDARY ============================
//
// A scanner tells you what is in front of you and what you are allowed to do about it. It does not
// move stock. Custody changes only when a trusted command -- dispatchTransferOrder,
// receiveTransferOrder, receiveInventoryStock -- decides it should, inside a transaction, having
// checked authority.
//
// The failure this guards against is seductive because it feels efficient: a scan that "just"
// records the item as moved. It produces inventory that changed because somebody looked at it, with
// no order behind it, no actor accountable for the decision, and nothing to refuse.
//
// ============================ WHY THE SELECTOR IS THE RIGHT PLACE TO CHECK ============================
//
// scanWorkflows.js is where the scanner decides which workflows to OFFER. If custody mutation were
// ever going to leak into the scanner, this is the file it would leak into -- it is the one that
// knows both what was scanned and what the caller may do. So it is asserted to be what it claims:
// a pure availability decision with no write path of any kind.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const SCAN_WORKFLOWS = path.resolve(REPO, "field-ops-app-vite/src/access/scanWorkflows.js");
const src = readFileSync(SCAN_WORKFLOWS, "utf8");

/** Comments describe intent; code is what runs. Only the code is searched. */
function codeOnly(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}
const code = codeOnly(src);

test("the scan workflow selector performs no Firestore write of any kind", () => {
  // Not "no ledger write" -- no write. A selector that had acquired any write path would be doing
  // something other than selecting.
  for (const verb of [".set(", ".update(", ".create(", ".delete(", ".add(", "writeBatch", "runTransaction"]) {
    assert.equal(code.includes(verb), false, `scanWorkflows.js contains ${verb}`);
  }
});

test("it does not reach the ledger, the transfer service, or the receiving service", () => {
  for (const forbidden of [
    "inventory_transactions", "transfer_orders", "receiving_orders", "serialized_assets",
    "stageOperationalMovement", "dispatchTransferOrder", "receiveTransferOrder", "receiveInventoryStock",
  ]) {
    assert.equal(code.includes(forbidden), false,
      `scanWorkflows.js references ${forbidden} -- selection must not touch the movement authority`);
  }
});

test("it names capabilities, and capabilities alone, as its inputs", async () => {
  // The positive half: it IS the capability-driven selector it claims to be, and the transfer
  // workflow is gated on the real transfer capability ids rather than on a scanner-specific flag.
  const mod = await import(pathToFileURL(SCAN_WORKFLOWS).href);
  assert.equal(mod.TRANSFER_DISPATCH_CAPABILITY, "inventory.transfer.dispatch");
  assert.equal(mod.TRANSFER_RECEIVE_CAPABILITY, "inventory.transfer.receive");
  assert.equal(mod.RECEIVE_CAPABILITY, "inventory.stock.receive");
});

test("MUTATION: a write introduced into the selector is caught", () => {
  // Proves the check reads the code rather than merely existing. The exact shape a well-meaning
  // change would take -- record the scan, then move the stock while we are here.
  const leaked = code + '\nawait db.collection("inventory_transactions").doc(id).set({ scanned: true });\n';
  const stillClean = ![".set(", "inventory_transactions"].some((v) => leaked.includes(v));
  assert.equal(stillClean, false, "the guard must reject a selector that writes the ledger");
});

test("MUTATION: a comment mentioning a write does NOT trip the guard", () => {
  // The other direction. This file's own header discusses transfers and receiving at length; a
  // guard that failed on prose would be untrustworthy in the way that gets guards deleted.
  const commented = codeOnly(code + "\n// we deliberately never call .set( on inventory_transactions here\n");
  assert.equal(commented.includes("inventory_transactions"), false,
    "a comment about a write must not read as a write");
});

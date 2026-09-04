// EOS Data Import P1 -- the production refusal, at the CALLABLE.
//
// A SEPARATE PROCESS from the end-to-end test, and it has to be: the runtime's project
// identity is read from the environment at load time and is exactly what is under test, so
// a suite that already loaded as the sandbox cannot honestly claim anything about
// production. This file loads as `taylor-parts` and asserts that every entry point refuses.
//
// importTargetGuard.test.mjs already proves the guard itself. This proves the guard is
// actually WIRED -- and wired ahead of authorization, which is the part a reviewer cannot
// see from the guard's own tests. A production principal's authority is never evaluated,
// because the environment answer comes first.
//
// NO EMULATOR AND NO CREDENTIALS ARE NEEDED, which is itself the assertion: if any call
// reached Firestore, this test would hang or fail on credentials rather than pass. Refusal
// happens before anything touches a database.
process.env.GCLOUD_PROJECT = "taylor-parts";

import test from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });

const { stageDataImportCallable, executeDataImportCallable, listDataImportJobsCallable } =
  await import("../lib/dataImport/dataImportCallables.js");

// An authenticated caller who, in a sandbox, would be an administrator. The point is that
// it does not matter who this is.
const auth = { uid: "would-be-admin", token: {} };

const CSV = ["PART_NO,NAME,UOM,CONTROL_TYPE,STOCK_CLASS", "PRD-1,Should never land,EA,STANDARD,STOCKED"].join("\n");

test("every Data Import entry point refuses the production project", async () => {
  for (const [name, call] of [
    ["stage", () => stageDataImportCallable.run({ data: { fileName: "x.csv", fileText: CSV }, auth })],
    ["execute", () => executeDataImportCallable.run({ data: { jobId: "IMP-1", approved: true }, auth })],
    ["list", () => listDataImportJobsCallable.run({ data: {}, auth })],
  ]) {
    await assert.rejects(
      call,
      (err) =>
        err.code === "failed-precondition" &&
        // The message names the ENVIRONMENT, not the caller. Refusing with
        // "you are not authorized" would send an administrator looking for a permission
        // that would not have helped -- import is off here for everyone, permanently.
        /not available in this environment/i.test(err.message),
      `${name} must refuse in production`,
    );
  }
});

test("the refusal does not depend on who is asking -- an unauthenticated call fails FIRST on auth", async () => {
  // Authentication is gate 1 and the target is gate 2, so this one is unauthenticated. The
  // ordering matters: nothing about the environment is disclosed to an anonymous caller.
  await assert.rejects(
    listDataImportJobsCallable.run({ data: {}, auth: null }),
    (err) => err.code === "unauthenticated",
  );
});

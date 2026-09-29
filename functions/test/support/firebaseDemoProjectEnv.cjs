"use strict";
// For tests that import the compiled entry lib/index.js, which calls initializeApp() with NO options at
// import time. The SDK gate in ./firebaseTestGuard.cjs refuses an initializeApp that cannot name a
// demo- project, so these tests name one explicitly. Load it AFTER the guard entry: the guard has
// already refused a governed project id exported by the caller, so this only fills an absence.
if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = "demo-eos-test";

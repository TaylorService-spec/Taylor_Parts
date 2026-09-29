"use strict";
// OFFLINE-MODE entry of the Firebase test-safety guard. MUST be the first import/require of a test
// that loads the Firebase Admin SDK without an emulator (value classes such as Timestamp, fakes,
// refusal-before-initializeApp proofs). See ./firebaseTestGuard.cjs.
require("./firebaseTestGuard.cjs").enforce("offline");

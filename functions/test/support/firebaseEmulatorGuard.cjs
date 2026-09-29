"use strict";
// EMULATOR-MODE entry of the Firebase test-safety guard. MUST be the first import/require of a test
// that talks to the Firestore / Auth emulators. See ./firebaseTestGuard.cjs.
require("./firebaseTestGuard.cjs").enforce("emulator");

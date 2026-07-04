// Reusable Firestore Admin SDK helpers for direct, rules-bypassing,
// ground-truth checks against the live taylor-parts project. Built
// after repeatedly hand-rolling one-off scratch scripts for this same
// need (checking a doc's real existence, the actually-deployed rules,
// live collection lists) across a single session.
//
// Usage: const admin = require("<path-to-this-skill>/lib.js")(keyPath);
// then await admin.getDoc("users", uid), admin.listCollection("fieldops_jobs"),
// admin.listAllCollections(), admin.getDeployedRules().
//
// keyPath: absolute path to a Firebase service account JSON key, generated
// via Firebase console -> Project Settings -> Service Accounts -> Generate
// new private key. MUST be saved OUTSIDE this repo (e.g. Downloads), and
// should never be committed or pasted into chat -- treat as compromised
// and rotate if it ever is.
const path = require("path");

module.exports = function initAdmin(keyPath) {
  const { initializeApp, cert, getApps } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const { getSecurityRules } = require("firebase-admin/security-rules");

  if (getApps().length === 0) {
    initializeApp({ credential: cert(require(path.resolve(keyPath))) });
  }

  const db = getFirestore();
  const auth = getAuth();

  return {
    db,
    auth,

    async getDoc(collectionName, id) {
      const snap = await db.collection(collectionName).doc(id).get();
      return { exists: snap.exists, data: snap.exists ? snap.data() : null };
    },

    async listCollection(collectionName) {
      const snap = await db.collection(collectionName).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    // Ground truth for "what collections actually exist" -- the check
    // that caught docs describing fieldops_inventory/fieldops_job_events
    // as real when the live database had no such collections at all.
    async listAllCollections() {
      const collections = await db.listCollections();
      const result = {};
      for (const col of collections) {
        const snap = await col.get();
        result[col.id] = snap.size;
      }
      return result;
    },

    // The only reliable way to know what's actually live -- a repo file
    // or a console screenshot is not evidence of what's deployed.
    async getDeployedRules() {
      const ruleset = await getSecurityRules().getFirestoreRuleset();
      return { name: ruleset.name, content: ruleset.source[0].content };
    },

    async getUserByEmail(email) {
      return auth.getUserByEmail(email);
    },
  };
};

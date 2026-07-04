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
//
// If keyPath is omitted, falls back to the path stored in
// keypath.local.txt (gitignored -- stores only the file *path*, never the
// key itself) via readSavedKeyPath()/saveKeyPath() below.
const fs = require("fs");
const path = require("path");

const SAVED_PATH_FILE = path.join(__dirname, "keypath.local.txt");

function readSavedKeyPath() {
  if (!fs.existsSync(SAVED_PATH_FILE)) return null;
  const saved = fs.readFileSync(SAVED_PATH_FILE, "utf8").trim();
  return saved || null;
}

function saveKeyPath(keyPath) {
  fs.writeFileSync(SAVED_PATH_FILE, path.resolve(keyPath) + "\n");
}

function initAdmin(keyPath) {
  const { initializeApp, cert, getApps } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const { getSecurityRules } = require("firebase-admin/security-rules");

  const resolvedKeyPath = keyPath || readSavedKeyPath();
  if (!resolvedKeyPath) {
    throw new Error(
      "No service account key path given and none saved in keypath.local.txt. " +
      "Pass a path explicitly, or call saveKeyPath(path) once to remember it."
    );
  }

  if (getApps().length === 0) {
    initializeApp({ credential: cert(require(path.resolve(resolvedKeyPath))) });
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

    // Writes bypass Firestore rules AND this repo's app-level invariant
    // that only domain/jobActions.js writes job/technician state -- there
    // is no emulator, so these hit the real live database. Use for
    // seeding/asset creation the app itself has no UI path for; never as
    // a shortcut around assignJob()/updateJobStatus() for job/technician
    // state changes the app already knows how to make. No delete helper
    // is provided here deliberately -- deletion against live prod data
    // needs an explicit, per-use ask, not a standing capability.
    async setDoc(collectionName, id, data, options) {
      await db.collection(collectionName).doc(id).set(data, options || {});
      return { id };
    },

    async addDoc(collectionName, data) {
      const ref = await db.collection(collectionName).add(data);
      return { id: ref.id };
    },

    async updateDoc(collectionName, id, data) {
      await db.collection(collectionName).doc(id).update(data);
      return { id };
    },
  };
}

module.exports = initAdmin;
module.exports.saveKeyPath = saveKeyPath;
module.exports.readSavedKeyPath = readSavedKeyPath;

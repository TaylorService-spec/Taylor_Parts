// THE CENSUS, AS A TEST.
//
// "Firebase authenticates. EOS authorizes." The three numbers that statement reduces to are:
//
//   DIRECT CLIENT GOVERNED BUSINESS READS   0
//   DIRECT CLIENT GOVERNED BUSINESS WRITES  0
//   FIRESTORE EOS AUTHORIZATION DECISIONS   0
//
// They were reached by measurement, and measurement decays. This file is why they cannot quietly
// stop being true: a new `getDocs(collection(db, "anything"))` anywhere under src/ fails here, by
// name, with the file that introduced it.
//
// ════════════════════ WHY A CENSUS AND NOT A LINT RULE ════════════════════
//
// Twice during this workstream a count was wrong in the same direction, and both times the reason
// was the same: something was excluded from the count as "infrastructure" or "out of scope" and the
// exclusion was never written down where the next reader would see it. So the survivors are
// ENUMERATED here, each with the reason it survives. An exception nobody can find is how the count
// drifts back.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

function everySourceFile(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...everySourceFile(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped: a file that EXPLAINS a Firestore call is not a file that makes one. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");

const READ_APIS = ["getDoc", "getDocs", "onSnapshot", "collectionGroup"];
const WRITE_APIS = ["addDoc", "setDoc", "updateDoc", "deleteDoc", "runTransaction", "writeBatch"];

// The ONLY files permitted to call a Firestore read API, each with its reason. Every one reads
// `users/{own uid}` and nothing else.
const ACCESS_VERSION_FEED =
  "the governed capability feed: subscribes to the caller's OWN users/{uid} document to learn when " +
  "their access changed. This is the one client read the staged firestore.rules still grants, and " +
  "it is why -- denying it would break the very model the Rules file defers to.";

const ALLOWED_READERS = new Map(
  [
    "access/useGovernedCapabilities.js",
    "access/useEquipmentInstallCapability.js",
    "access/useOpportunityCapabilities.js",
    "access/useReportCapabilities.js",
    "access/useSalesOrderCapabilities.js",
    "access/useSerializedAssetAcquireCapability.js",
    "access/useWorkOrderPartsPlanCapability.js",
    "metadata/definitions/accountPageComponents.js",
  ].map((f) => [f, ACCESS_VERSION_FEED]),
);

const FILES = everySourceFile(SRC).map((f) => ({ path: rel(f), text: code(readFileSync(f, "utf8")) }));

const calls = (text, apis) => apis.filter((api) => new RegExp(`\\b${api}\\s*\\(`).test(text));

describe("the client Firestore census", () => {
  it("DIRECT CLIENT GOVERNED BUSINESS WRITES: 0", () => {
    // No exceptions at all, and none is coming: every business write goes through a trusted command
    // that resolves a capability server-side. The shared client write transport that used to carry
    // them (collectionStore / firebaseSafe) is DELETED rather than dormant, because a generic
    // direct-write path with no caller is precisely what a later "just this once" reaches for.
    const writers = FILES.filter((f) => calls(f.text, WRITE_APIS).length > 0).map((f) => f.path);
    expect(writers).toEqual([]);
  });

  it("DIRECT CLIENT GOVERNED BUSINESS READS: 0 -- every survivor is the accessVersion feed", () => {
    const readers = FILES.filter((f) => calls(f.text, READ_APIS).length > 0).map((f) => f.path).sort();
    const unexpected = readers.filter((f) => !ALLOWED_READERS.has(f));
    expect(
      unexpected,
      `these files read Firestore directly and are not part of the accessVersion feed:\n  ${unexpected.join("\n  ")}\n` +
        "A governed business read belongs behind readGovernedList or the scoped work-order seam.",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries -- an exception that stops applying is removed", () => {
    // A validator whose exceptions outlive their reason stops being a validator. This is what makes
    // the list shrink when one of these is finally migrated, rather than sitting there forever.
    const readers = new Set(FILES.filter((f) => calls(f.text, READ_APIS).length > 0).map((f) => f.path));
    for (const file of ALLOWED_READERS.keys()) {
      expect(readers.has(file), `${file} no longer reads Firestore -- remove it from the allowlist`).toBe(true);
    }
  });

  it("every surviving read is the caller's OWN user document, never a collection", () => {
    // The distinction that makes these access rather than authorization. A doc() read of one's own
    // uid cannot become a directory read; a collection() read can.
    for (const file of ALLOWED_READERS.keys()) {
      const text = FILES.find((f) => f.path === file).text;
      expect(text, `${file} must read users/{uid} by document`).toMatch(/doc\(db, USERS_COLLECTION, uid\)/);
      expect(text, `${file} must not open a collection`).not.toMatch(/\bcollection\s*\(\s*db/);
    }
  });

  it("FIRESTORE EOS AUTHORIZATION DECISIONS: 0 -- the feed reads a VERSION, not a role", () => {
    // These hooks subscribe to the user document. What they may never do is read an authorization
    // answer out of it: the capability decision comes from the server, and accessVersion only says
    // WHEN to ask again.
    for (const file of ALLOWED_READERS.keys()) {
      const text = FILES.find((f) => f.path === file).text;
      expect(text, `${file} must not branch on the legacy role`).not.toMatch(/\.role\s*===/);
      expect(text, `${file} must not read Role definitions from the user document`).not.toMatch(
        /data\(\)\??\.(role|permissions|roles)\b/,
      );
    }
  });

  it("every relative import resolves to a file that exists", () => {
    // ════════════════════ THE COST OF DELETING THINGS ════════════════════
    //
    // This workstream deleted five modules, and twice a file was left importing one of them. Both
    // times the CLIENT BUILD was the only thing that noticed: `tsc` did not, because these are
    // untyped .js modules, and vitest did not, because the importing module was mocked in every
    // test that reached it. The app simply did not build, on a branch whose suites were green.
    //
    // A dangling import is not a Firestore question, but it is the same failure this file exists
    // to prevent -- a deletion that looks complete because nothing measured what still pointed at
    // it -- and catching it here costs milliseconds instead of a full production build.
    const unresolved = [];
    const EXTENSIONS = ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts"];
    for (const file of FILES) {
      const dir = path.dirname(path.join(SRC, file.path));
      // Anchored to an actual import STATEMENT. An unanchored /from "..."/ also matches a regex
      // literal that happens to contain the word, which is how this guard first reported
      // recordPageManifest.js importing a regular expression.
      for (const m of file.text.matchAll(/^\s*(?:import\b|export\b|\})[^\n]*?\bfrom\s+"(\.[^"]+)"/gm)) {
        const spec = m[1];
        const base = path.resolve(dir, spec);
        // A `.js` specifier may name a `.ts` source: this project writes extensioned imports and
        // the bundler resolves them, so the candidate list has to as well.
        const candidates = [
          ...EXTENSIONS.map((ext) => base + ext),
          ...(base.endsWith(".js") ? [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".jsx"), base.replace(/\.js$/, ".tsx")] : []),
        ];
        if (!candidates.some((c) => existsSync(c))) unresolved.push(`${file.path} -> ${spec}`);
      }
    }
    expect(unresolved, `these imports point at files that do not exist:\n  ${unresolved.join("\n  ")}`).toEqual([]);
  });
  it("nothing outside the SDK bootstrap and the feed imports the Firestore SDK for values", () => {
    // A type-only import cannot issue a query, so those are counted separately rather than banned:
    // conflating them would either forbid types or hide a real client.
    const valueImporters = FILES.filter((f) => /import\s+\{[^}]*\}\s+from "firebase\/firestore"/.test(f.text))
      .filter((f) => !/import\s+type\s/.test(f.text.match(/import[^;]*from "firebase\/firestore"/)?.[0] ?? ""))
      .map((f) => f.path)
      .sort();
    const allowed = new Set([...ALLOWED_READERS.keys(), "firebase/firebase.js"]);
    expect(valueImporters.filter((f) => !allowed.has(f))).toEqual([]);
  });
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  OPERATIONS,
  VerificationError,
  assertEvidenceSecretFree,
  extractRulesSource,
  interpretStatus,
  normalizeFunctionsInventory,
  sha256,
  validateConfig,
  verifyDeploymentLog,
  writeEvidence,
} = require("../scripts/firestoreDeploymentVerificationShared");

const config = {
  projectId: "taylor-parts",
  confirmProject: "taylor-parts",
  governedCommit: "a".repeat(40),
  governedRulesSha256: "b".repeat(64),
  webApiKeyEnv: "FIREBASE_WEB_API_KEY",
  personas: ["admin", "dispatcher", "PARTS_MANAGER", "WAREHOUSE_MANAGER", "technician"].map((label, index) => ({
    label,
    emailEnv: `P${index}_EMAIL`,
    passwordEnv: `P${index}_PASSWORD`,
  })),
};

test("configuration pins project, full commit/hash, and exactly the governed personas", () => {
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, confirmProject: "other" }), VerificationError);
  assert.throws(() => validateConfig({ ...config, personas: config.personas.slice(1) }), VerificationError);
});

test("matrix is the complete 55-probe Stage B contract", () => {
  assert.equal(OPERATIONS.length, 11);
  assert.equal(OPERATIONS.filter((op) => op.method !== "GET").length, 6);
  assert.deepEqual(interpretStatus("admin", OPERATIONS[0], 200), {
    expected: [200], pass: true, interpretation: "ALLOW",
  });
  assert.deepEqual(interpretStatus("PARTS_MANAGER", OPERATIONS[1], 404), {
    expected: [404], pass: true, interpretation: "ALLOW_NOT_FOUND",
  });
  assert.equal(interpretStatus("technician", OPERATIONS[0], 403).pass, true);
  assert.equal(interpretStatus("admin", OPERATIONS[2], 200).pass, false);
});

test("deployment scope accepts Rules-only and rejects Functions or incomplete logs", () => {
  const ok = verifyDeploymentLog("i deploying firestore\nreleased rules firestore.rules to cloud.firestore\nDeploy complete!");
  assert.equal(ok.firestoreRulesOnly, true);
  assert.throws(() => verifyDeploymentLog("deploying firestore\ndeploying functions\nreleased rules firestore.rules"), VerificationError);
  assert.throws(() => verifyDeploymentLog("Deploy complete!"), VerificationError);
});

test("live source extraction distinguishes source bytes from API artifact", () => {
  const source = "rules_version = '2';\nservice cloud.firestore {}\n";
  assert.equal(extractRulesSource({ source: { files: [{ name: "firestore.rules", content: source }] } }), source);
  assert.equal(sha256(source).length, 64);
  assert.throws(() => extractRulesSource({ source: { files: [] } }), VerificationError);
});

test("Functions comparison normalization is deterministic and excludes volatile metadata", () => {
  const payload = { functions: [
    { name: "projects/p/locations/r/functions/z", updateTime: "2", labels: { volatile: "x" }, buildConfig: { runtime: "nodejs20" } },
    { name: "projects/p/locations/r/functions/a", updateTime: "1", serviceConfig: { serviceAccountEmail: "service-account-address" } },
  ] };
  assert.deepEqual(normalizeFunctionsInventory(payload).map((f) => f.name), [
    "projects/p/locations/r/functions/a",
    "projects/p/locations/r/functions/z",
  ]);
});

test("evidence writer refuses credentials and creates checksummed sanitized artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-verification-test-"));
  try {
    assert.throws(() => assertEvidenceSecretFree({ idToken: "secret" }), VerificationError);
    writeEvidence(dir, { "summary.json": { pass: true, persona: "admin" } });
    assert.match(fs.readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8"), /summary\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

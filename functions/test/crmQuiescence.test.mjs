import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertExportInvocation, sourceDataDigest } = require("../scripts/exportCrmSnapshot.js");

const baseSnapshot = (exportedAt = "2026-09-16T20:00:00.000Z") => ({
  format: "EOS_CRM_SNAPSHOT",
  version: 1,
  exporter: "FIREBASE_EXIT_MIGRATION_ONLY",
  source: {
    environmentId: "platform-sandbox",
    firebaseProjectId: "eos-platform-sandbox",
    exportedAt,
  },
  accounts: [{ id: "acct-a", data: { name: "A", status: "ACTIVE" } }],
  contacts: [{ id: "contact-a", data: { accountId: "acct-a", name: "C" } }],
  locations: [{ id: "location-a", data: { accountId: "acct-a", name: "L" } }],
});

test("sourceDataDigest ignores export timestamp and hashes only the bounded CRM source payload", () => {
  const first = baseSnapshot("2026-09-16T20:00:00.000Z");
  const later = baseSnapshot("2026-09-16T20:05:00.000Z");
  later.unrelatedMetadata = { ignored: true };
  assert.equal(sourceDataDigest(first), sourceDataDigest(later));
  assert.match(sourceDataDigest(first), /^[0-9a-f]{64}$/);
});

test("sourceDataDigest changes when any selected CRM source fact changes", () => {
  const baseline = baseSnapshot();
  const changed = baseSnapshot();
  changed.contacts[0].data.name = "Changed";
  assert.notEqual(sourceDataDigest(baseline), sourceDataDigest(changed));
});

test("sourceDataDigest refuses an incomplete source payload", () => {
  const incomplete = baseSnapshot();
  delete incomplete.locations;
  assert.throws(() => sourceDataDigest(incomplete), /snapshot\.locations to be a list/);
});

test("quiescence expected digest is validated before any Firebase client is needed", () => {
  const out = join(mkdtempSync(join(tmpdir(), "crm-quiescence-")), "snapshot.json");
  const env = { EOS_ENVIRONMENT: "nonprod" };
  assert.throws(
    () => assertExportInvocation({ environment: "platform-sandbox", out, expectSourceDataSha256: "not-a-digest" }, env),
    /exactly 64 hexadecimal characters/,
  );
});

test("a valid expected digest is normalized and retained for the live-source comparison", () => {
  const out = join(mkdtempSync(join(tmpdir(), "crm-quiescence-")), "snapshot.json");
  const upper = "A".repeat(64);
  const result = assertExportInvocation(
    { environment: "platform-sandbox", out, expectSourceDataSha256: upper },
    { EOS_ENVIRONMENT: "nonprod" },
  );
  assert.equal(result.expectedSourceDataSha256, upper.toLowerCase());
  assert.equal(result.environmentId, "platform-sandbox");
  assert.equal(result.projectId, "eos-platform-sandbox");
});

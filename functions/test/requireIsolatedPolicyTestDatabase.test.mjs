// ONE LANE, ONE TEST DATABASE: the pretest refusal for test:adminPolicyPostgres.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { isolationRefusal, checkPolicyTestDatabase, SHARED_DATABASES } from "../scripts/requireIsolatedPolicyTestDatabase.mjs";

test("the cluster's shared databases are refused, whatever is connected", () => {
  for (const name of [...SHARED_DATABASES, "", null]) assert.match(isolationRefusal(name, []), /shared database/);
});

test("a lane database with another client connected is refused, and says who", () => {
  const r = isolationRefusal("lane_x_gate", [{ application_name: "", backend_start: "2026-10-12T08:09:00Z" }]);
  assert.match(r, /1 other client session/);
  assert.match(r, /\(unnamed\) since 2026-10-12T08:09:00.000Z/);
});

test("a lane database nobody else is using is accepted", () => {
  assert.equal(isolationRefusal("lane_x_gate", []), null);
});

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
test("against real PostgreSQL: a fresh lane database passes; a second connection makes it refuse", { skip: URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set" }, async () => {
  const name = `isolation_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(URL_BASE);
  url.pathname = `/${name}`;
  const other = new pg.Client({ connectionString: url.toString(), application_name: "another-lane" });
  try {
    assert.equal(await checkPolicyTestDatabase(url.toString()), null);
    await other.connect();
    assert.match(await checkPolicyTestDatabase(url.toString()), /another-lane since/);
  } finally {
    await other.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});

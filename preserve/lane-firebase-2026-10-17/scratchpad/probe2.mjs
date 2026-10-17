import { createRequire } from "node:module";
import { endPoolAndDrain } from "./poolTeardown.mjs";
const require = createRequire("/home/rudy2/fbx/functions/package.json");
const pg = require("pg");
const BASE = "postgres://eos@127.0.0.1:55507/postgres";
let errors = 0, attached = 0;
for (let i = 0; i < 40; i += 1) {
  const db = `probe2_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: BASE }); await admin.connect();
  await admin.query(`CREATE DATABASE ${db}`);
  const pool = new pg.Pool({ connectionString: `postgres://eos@127.0.0.1:55507/${db}`, max: 16 });
  pool.on("error", () => { errors += 1; }); // probe only
  await Promise.all(Array.from({ length: 16 }, () => pool.query("select pg_sleep(0.02)")));
  await endPoolAndDrain(pool);
  const { rows } = await admin.query("select count(*)::int n from pg_stat_activity where datname=$1", [db]);
  if (rows[0].n > 0) attached += 1;
  await admin.query(`DROP DATABASE ${db} WITH (FORCE)`); await admin.end();
}
await endPoolAndDrain(null); // no-op
console.log(`endPoolAndDrain: runs with backends attached after teardown = ${attached}/40; 57P01 errors = ${errors}`);

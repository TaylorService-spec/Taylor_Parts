// Does pg-pool's end() resolve before its backends have disconnected?
const pg = require("/home/rudy2/fbx/functions/node_modules/pg");
const BASE = "postgres://eos@127.0.0.1:55507/postgres";
const urlFor = (db) => `postgres://eos@127.0.0.1:55507/${db}`;
let errors = 0;
async function once(drain) {
  const db = `probe_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: BASE }); await admin.connect();
  await admin.query(`CREATE DATABASE ${db}`);
  const pool = new pg.Pool({ connectionString: urlFor(db), max: 16 });
  const open = new Set(); let allClosed = null;
  pool.on("error", () => { errors += 1; }); // PROBE ONLY: count what would be an uncaughtException
  pool.on("connect", (c) => open.add(c));
  pool.on("remove", (c) => { open.delete(c); if (!open.size) allClosed?.(); });
  await Promise.all(Array.from({ length: 16 }, () => pool.query("select pg_sleep(0.02)")));
  const drained = drain && open.size ? new Promise((r) => { allClosed = r; }) : null;
  await pool.end();
  await drained;
  const { rows } = await admin.query("select count(*)::int n from pg_stat_activity where datname=$1", [db]);
  await admin.query(`DROP DATABASE ${db} WITH (FORCE)`);
  await admin.end();
  return rows[0].n;
}
(async () => {
  for (const drain of [false, true]) {
    errors = 0; const counts = []; for (let i = 0; i < 20; i += 1) counts.push(await once(drain));
    console.log(`${drain ? "drained " : "end only"}: runs with backends still attached after end() = ${counts.filter((n) => n > 0).length}/20; max still attached = ${Math.max(...counts)}; 57P01 errors on ending clients = ${errors}`);
  }
})().catch((e) => { console.error("PROBE ERROR", e); process.exit(1); });

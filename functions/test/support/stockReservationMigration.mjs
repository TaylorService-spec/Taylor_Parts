// S1b: apply the stock-reservation migration to a freshly migrated test database.
//
// WHY THIS EXISTS. The S1b migration (company + warehouse on `inventory_commitments`) is authored by the controller into
// `functions/migrations/` (an agent lane cannot write there). Until that file lands, the SQL travels with the PR as
// `test/support/pendingMigrations/<slot>_<name>.sql.txt` and the suites that touch commitments apply it here, right after
// `node-pg-migrate up`. Once the controller writes `migrations/<slot>_<name>.sql`, `migrate up` already applied it, this
// helper becomes a no-op, and the `.txt` copy should be deleted.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME = "1764710000000_stock-reservation-company-warehouse";

export const STOCK_RESERVATION_MIGRATION_LANDED = existsSync(join(FUNCTIONS_DIR, "migrations", `${NAME}.sql`));

/** `client` is a connected pg Client/PoolClient/Pool on the migrated database. */
export async function applyStockReservationMigration(client) {
  if (STOCK_RESERVATION_MIGRATION_LANDED) return;
  const sql = readFileSync(join(FUNCTIONS_DIR, "test", "support", "pendingMigrations", `${NAME}.sql.txt`), "utf8");
  const up = sql.split(/^-- Down Migration/m)[0].replace(/^-- Up Migration/m, "");
  await client.query(up);
}

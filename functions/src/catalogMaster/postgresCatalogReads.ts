// THE GOVERNED CATALOG READS -- bounded, and shaped by the question each screen actually asks.
//
// ════════════════════ DO NOT RECREATE THE CLIENT FIRESTORE PROBLEM ════════════════════
//
// The Firestore client reads the WHOLE `parts` collection from six surfaces
// (`partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ`). Turning that into "the whole
// PostgreSQL table over HTTP" would move the defect rather than fix it: the same unbounded read,
// one network hop further away, and now with a server paying for it too.
//
// So each read here answers ONE question:
//
//   readPart(partId)            PartDetail: one Part, by id.
//   readPartsByIds(partIds)     the canonical-name resolver: the ids a page is already showing.
//   searchParts(...)            administration lists and pickers: a BOUNDED, searchable page.
//
// `searchParts` has a hard ceiling that is not negotiable by the caller: `limit` is clamped, never
// trusted. A caller asking for a million rows gets the ceiling, because the protection has to live
// where it cannot be argued with rather than in the callers' good manners.
//
// A KEYSET cursor, not an offset. Offset paging silently repeats or skips rows when the underlying
// set changes between pages, and a catalogue picker that quietly drops a Part is worse than one that
// refuses to page at all.

import type { PoolClient } from "pg";
import { PART_SELECT, partFromRow, type CanonicalPart } from "./catalogRows.js";

const SCHEMA = "eos_ops";

/** The most rows any single Catalog read will ever return. Clamped, never trusted from input. */
export const PART_SEARCH_MAX_LIMIT = 100;
export const PART_SEARCH_DEFAULT_LIMIT = 50;
/** `readPartsByIds` answers about ids a caller already holds, so its ceiling is the page size. */
export const PART_BY_IDS_MAX = 200;

export interface PartSearchPage {
  readonly parts: readonly CanonicalPart[];
  /** The cursor for the NEXT page, or null at the end. Opaque to the caller. */
  readonly nextCursor: string | null;
  readonly limit: number;
}

export async function readPart(
  client: Pick<PoolClient, "query">, tenantId: string, partId: string,
): Promise<CanonicalPart | null> {
  if (typeof partId !== "string" || partId.trim() === "") return null;
  const { rows } = await client.query(`${PART_SELECT} WHERE tenant_id = $1 AND id = $2`, [tenantId, partId]);
  return rows.length === 0 ? null : partFromRow(rows[0]);
}

/**
 * The ids a page is already showing, resolved to their canonical names.
 *
 * Deliberately NOT "give me everything so I can look them up myself": the resolver knows exactly
 * which ids it needs, and asking for those is the difference between a bounded read and the whole
 * catalogue. Unknown ids are simply absent from the result -- a caller asking about a Part that does
 * not exist gets silence about it, not an error about the rest.
 */
export async function readPartsByIds(
  client: Pick<PoolClient, "query">, tenantId: string, partIds: readonly string[],
): Promise<readonly CanonicalPart[]> {
  const ids = [...new Set((partIds ?? []).filter((id) => typeof id === "string" && id.trim() !== ""))];
  if (ids.length === 0) return [];
  if (ids.length > PART_BY_IDS_MAX) {
    throw new Error(`readPartsByIds accepts at most ${PART_BY_IDS_MAX} ids; a larger question is a search`);
  }
  const { rows } = await client.query(
    `${PART_SELECT} WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id`, [tenantId, ids]);
  return rows.map(partFromRow);
}

export interface PartSearchInput {
  /** Matched against the part id, internal part number and name. Case-insensitive, prefix-ish. */
  readonly query?: string;
  readonly status?: string;
  readonly limit?: number;
  /** The `nextCursor` from a previous page. */
  readonly cursor?: string | null;
}

/**
 * A BOUNDED, searchable page of the catalogue.
 *
 * This is what every list, picker and administration screen gets. There is no "all parts" operation,
 * because there is no screen whose question is genuinely "all parts" -- the six surfaces that read
 * the whole Firestore collection today each want one of the three reads in this module.
 */
export async function searchParts(
  client: Pick<PoolClient, "query">, tenantId: string, input: PartSearchInput = {},
): Promise<PartSearchPage> {
  const requested = Number.isSafeInteger(input.limit) ? (input.limit as number) : PART_SEARCH_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requested, 1), PART_SEARCH_MAX_LIMIT);
  const q = typeof input.query === "string" && input.query.trim() !== "" ? input.query.trim() : null;
  const status = typeof input.status === "string" && input.status.trim() !== "" ? input.status.trim() : null;
  const cursor = typeof input.cursor === "string" && input.cursor.trim() !== "" ? input.cursor.trim() : null;

  const { rows } = await client.query(
    `${PART_SELECT}
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR (id ILIKE '%' || $2 || '%' OR internal_part_number ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%'))
        AND ($3::text IS NULL OR status::text = $3)
        AND ($4::text IS NULL OR id > $4)
      ORDER BY id
      LIMIT $5`,
    [tenantId, q, status, cursor, limit + 1],
  );
  // One row beyond the page is read to decide whether there IS a next page, and is then dropped. A
  // caller is never told "there might be more" on a guess.
  const page = rows.slice(0, limit).map(partFromRow);
  const nextCursor = rows.length > limit && page.length > 0 ? page[page.length - 1].id : null;
  return Object.freeze({ parts: page, nextCursor, limit });
}

/** Count the catalogue, for a screen that shows a total without listing it. */
export async function countParts(
  client: Pick<PoolClient, "query">, tenantId: string,
): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.parts WHERE tenant_id = $1`, [tenantId]);
  return Number(rows[0].n);
}

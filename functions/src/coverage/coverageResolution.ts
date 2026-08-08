// Commercial Coverage — PURE resolver (TS mirror of field-ops-app-vite/src/domain/commercialCoverage.js). Given
// a commercial context + the stored coverage assignments (+ territories for geographic scopes), returns ALL
// coverage assignments EFFECTIVE at `now` whose scope matches — geographic AND account/corporate AND channel
// coverage COEXIST; it NEVER picks a single primary, computes credit/commission, or returns an owner
// (precedence/credit/commission are deferred). Fail-closed → []. No I/O.

const norm = (v: unknown): string | null => (typeof v === "string" ? v.trim().toUpperCase() : null);

export interface TerritoryLike { kind?: string; geo?: { states?: string[]; zips?: string[]; zipPrefixes?: string[]; polygonRef?: string } }
export interface CoverageContext {
  accountId?: string;
  corporateAccountIds?: string[];
  namedAccountIds?: string[];
  channelId?: string;
  location?: { state?: string; zip?: string | number };
}
export interface CoverageAssignmentLike {
  assignmentId?: string;
  scope?: { kind?: string; territoryId?: string; accountId?: string; namedAccountId?: string; corporateAccountId?: string; channelId?: string };
  effectiveFrom?: number;
  effectiveTo?: number | null;
  [k: string]: unknown;
}

// Does a territory cover a location's geography? GEOSPATIAL fails closed (no geometry engine).
export function territoryCoversLocation(territory: TerritoryLike, location: CoverageContext["location"] = {}): boolean {
  if (!territory || typeof territory !== "object") return false;
  const geo = territory.geo ?? {};
  const state = norm(location?.state);
  const zip = typeof location?.zip === "string" ? location.zip.trim() : (typeof location?.zip === "number" ? String(location.zip) : null);
  switch (territory.kind) {
    case "STATE":
    case "STATE_GROUP":
      return Array.isArray(geo.states) && state != null && geo.states.map(norm).includes(state);
    case "ZIP_GROUP": {
      if (zip == null) return false;
      const exact = Array.isArray(geo.zips) && geo.zips.includes(zip);
      const prefixed = Array.isArray(geo.zipPrefixes) && geo.zipPrefixes.some((p) => typeof p === "string" && zip.startsWith(p));
      return exact || prefixed;
    }
    default:
      return false; // GEOSPATIAL / unknown — never fabricate a hit
  }
}

export function isEffective(a: CoverageAssignmentLike, now: number): boolean {
  if (!a || typeof now !== "number") return false;
  const from = typeof a.effectiveFrom === "number" ? a.effectiveFrom : -Infinity;
  const to = typeof a.effectiveTo === "number" ? a.effectiveTo : Infinity;
  return from <= now && now < to;
}

function scopeMatches(a: CoverageAssignmentLike, ctx: CoverageContext, territoriesById: Record<string, TerritoryLike>): boolean {
  const scope = a?.scope ?? {};
  if (scope.channelId != null && scope.channelId !== ctx.channelId) return false; // channel constraint AND-ed
  switch (scope.kind) {
    case "ACCOUNT":
      return scope.accountId != null && scope.accountId === ctx.accountId;
    case "NAMED_ACCOUNT":
      return scope.namedAccountId != null && Array.isArray(ctx.namedAccountIds) && ctx.namedAccountIds.includes(scope.namedAccountId);
    case "CORPORATE":
      return scope.corporateAccountId != null && (scope.corporateAccountId === ctx.accountId || (Array.isArray(ctx.corporateAccountIds) && ctx.corporateAccountIds.includes(scope.corporateAccountId)));
    case "CHANNEL":
      return scope.channelId != null;
    case "TERRITORY": {
      const t = scope.territoryId != null ? territoriesById?.[scope.territoryId] : undefined;
      return t ? territoryCoversLocation(t, ctx.location ?? {}) : false;
    }
    default:
      return false;
  }
}

// Returns ALL effective + matching assignments (split coverage; nothing dropped; no winner).
export function resolveCommercialCoverage(
  ctx: CoverageContext = {},
  assignments: CoverageAssignmentLike[] = [],
  opts: { now: number; territoriesById?: Record<string, TerritoryLike> },
): CoverageAssignmentLike[] {
  const now = opts?.now;
  const territoriesById = opts?.territoriesById ?? {};
  if (typeof now !== "number" || !Array.isArray(assignments)) return [];
  return assignments.filter((a) => isEffective(a, now) && scopeMatches(a, ctx, territoriesById));
}

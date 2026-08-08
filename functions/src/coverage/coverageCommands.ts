// Commercial Coverage & Territory — PURE governed write command core (capability #15 persistence). Validates +
// builds the durable records the client authority model (field-ops-app-vite/src/domain/commercialCoverage.js)
// defines: a SALES TERRITORY (a coverage object independent of any salesperson) and a COVERAGE ASSIGNMENT (a
// person assigned to a scope, effective-dated). Records only — NO precedence/override/inheritance, NO winner,
// NO credit/commission (deferred per the ratified assessment). Coverage ≠ owner ≠ credit ≠ commission ≠
// security ≠ Service Territory. No I/O (the callable owns the write).

export const TERRITORY_KINDS = Object.freeze(["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"]);
export const COVERAGE_SCOPE_KINDS = Object.freeze(["TERRITORY", "ACCOUNT", "NAMED_ACCOUNT", "CORPORATE", "CHANNEL"]);
export const COVERAGE_PRIORITIES = Object.freeze(["PRIMARY", "SECONDARY", "OVERLAY"]);

export class CoverageCommandError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "CoverageCommandError"; this.code = code; }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(nonEmpty).map((s) => (s as string).trim()) : []);

// ── Sales Territory (durable coverage object) ───────────────────────────────────────────────────────────
export interface TerritoryInput {
  name: unknown;
  kind: unknown;
  geo?: unknown;
  status?: unknown;
}
export interface TerritoryRecord {
  name: string;
  kind: string;
  geo: Record<string, unknown>;
  status: string; // ACTIVE | INACTIVE
  createdAtMillis: number;
}

export function buildTerritory(input: TerritoryInput, deps: { nowMillis: number }): TerritoryRecord {
  if (!nonEmpty(input?.name)) throw new CoverageCommandError("REQUIRED", "territory name is required");
  if (!TERRITORY_KINDS.includes(input?.kind as string)) throw new CoverageCommandError("KIND_INVALID", `kind must be one of ${TERRITORY_KINDS.join("/")}`);
  const g = (input.geo ?? {}) as Record<string, unknown>;
  let geo: Record<string, unknown>;
  switch (input.kind) {
    case "STATE":
    case "STATE_GROUP": {
      const states = strList(g.states).map((s) => s.toUpperCase());
      if (states.length === 0) throw new CoverageCommandError("GEO_INVALID", `${String(input.kind)} territory requires geo.states[]`);
      geo = { states };
      break;
    }
    case "ZIP_GROUP": {
      const zips = strList(g.zips);
      const zipPrefixes = strList(g.zipPrefixes);
      if (zips.length === 0 && zipPrefixes.length === 0) throw new CoverageCommandError("GEO_INVALID", "ZIP_GROUP territory requires geo.zips[] or geo.zipPrefixes[]");
      geo = { ...(zips.length ? { zips } : {}), ...(zipPrefixes.length ? { zipPrefixes } : {}) };
      break;
    }
    default: {
      // GEOSPATIAL — an opaque reference to a future geometry authority (never resolved here).
      if (!nonEmpty(g.polygonRef)) throw new CoverageCommandError("GEO_INVALID", "GEOSPATIAL territory requires geo.polygonRef");
      geo = { polygonRef: (g.polygonRef as string).trim() };
    }
  }
  const status = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  return { name: (input.name as string).trim(), kind: input.kind as string, geo, status, createdAtMillis: deps.nowMillis };
}

// ── Coverage Assignment (person → scope, effective-dated) ───────────────────────────────────────────────
export interface AssigneeInput {
  assignedToEmployeeId?: unknown;
  assignedToUserId?: unknown;
  assignedToDisplayName?: unknown;
}
export interface CoverageScopeInput {
  kind?: unknown;
  territoryId?: unknown;
  accountId?: unknown;
  namedAccountId?: unknown;
  corporateAccountId?: unknown;
  channelId?: unknown;
}
export interface CoverageAssignmentInput {
  companyId: unknown;
  assignee: AssigneeInput;
  scope: CoverageScopeInput;
  responsibility?: unknown;
  priority?: unknown;
  effectiveFrom: unknown;
  effectiveTo?: unknown;
}

export interface CoverageAssignmentRecord {
  companyId: string;
  assignee: { assignedToEmployeeId: string; assignedToUserId: string; assignedToDisplayName: string | null };
  scope: Record<string, string>;
  responsibility: string | null;
  priority: string | null;
  effectiveFrom: number;
  effectiveTo: number | null;
  createdAtMillis: number;
}

export function buildCoverageAssignment(input: CoverageAssignmentInput, deps: { nowMillis: number }): CoverageAssignmentRecord {
  if (!nonEmpty(input?.companyId)) throw new CoverageCommandError("REQUIRED", "companyId is required");
  const a = input?.assignee ?? {};
  // A coverage assignment assigns a PERSON (the reciprocally-linked employee/user identity). Identity
  // resolution is separate; both refs are required so an assignment is never a dangling name.
  if (!nonEmpty(a.assignedToEmployeeId) || !nonEmpty(a.assignedToUserId)) {
    throw new CoverageCommandError("ASSIGNEE_INVALID", "assignee requires assignedToEmployeeId and assignedToUserId");
  }
  const s = input?.scope ?? {};
  if (!COVERAGE_SCOPE_KINDS.includes(s.kind as string)) throw new CoverageCommandError("SCOPE_INVALID", `scope.kind must be one of ${COVERAGE_SCOPE_KINDS.join("/")}`);
  const scope: Record<string, string> = { kind: s.kind as string };
  const requireRef = (field: keyof CoverageScopeInput) => {
    if (!nonEmpty(s[field])) throw new CoverageCommandError("SCOPE_INVALID", `scope.kind ${String(s.kind)} requires scope.${String(field)}`);
    scope[field] = (s[field] as string).trim();
  };
  switch (s.kind) {
    case "TERRITORY": requireRef("territoryId"); break;
    case "ACCOUNT": requireRef("accountId"); break;
    case "NAMED_ACCOUNT": requireRef("namedAccountId"); break;
    case "CORPORATE": requireRef("corporateAccountId"); break;
    case "CHANNEL": requireRef("channelId"); break;
  }
  // A channel constraint may accompany a geographic/account scope (AND-ed at resolve time).
  if (s.kind !== "CHANNEL" && nonEmpty(s.channelId)) scope.channelId = (s.channelId as string).trim();

  if (!isInt(input.effectiveFrom)) throw new CoverageCommandError("EFFECTIVE_FROM_INVALID", "effectiveFrom (ms epoch) is required");
  const effectiveTo = input.effectiveTo === undefined || input.effectiveTo === null ? null : input.effectiveTo;
  if (effectiveTo !== null && !isInt(effectiveTo)) throw new CoverageCommandError("EFFECTIVE_TO_INVALID", "effectiveTo must be a ms epoch or null (open-ended)");
  if (effectiveTo !== null && (effectiveTo as number) <= (input.effectiveFrom as number)) throw new CoverageCommandError("EFFECTIVE_RANGE_INVALID", "effectiveTo must be after effectiveFrom");

  const priority = COVERAGE_PRIORITIES.includes(input.priority as string) ? (input.priority as string) : null;
  return {
    companyId: (input.companyId as string).trim(),
    assignee: {
      assignedToEmployeeId: (a.assignedToEmployeeId as string).trim(),
      assignedToUserId: (a.assignedToUserId as string).trim(),
      assignedToDisplayName: nonEmpty(a.assignedToDisplayName) ? (a.assignedToDisplayName as string).trim() : null,
    },
    scope,
    responsibility: nonEmpty(input.responsibility) ? (input.responsibility as string).trim() : null,
    priority,
    effectiveFrom: input.effectiveFrom as number,
    effectiveTo: effectiveTo as number | null,
    createdAtMillis: deps.nowMillis,
  };
}

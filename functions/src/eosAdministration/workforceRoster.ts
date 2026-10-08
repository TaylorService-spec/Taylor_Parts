// THE WORKFORCE ROSTER (Administration control plane, DECISIONS #210) -- Administration -> Users, for MANY employees per Job Role.
//
// One bounded read of the SAME governed rows every other surface resolves from, per Employee:
//
//   Employee          eos_workforce.employees (name, number, status, operating company)
//   Job Role          eos_workforce.employee_job_role_assignments (effective_to IS NULL) -- a business function, never authority
//   Manager           eos_workforce.employee_reporting_relationships (current)
//   Work Eligibility  eos_workforce.employee_work_eligibility (current)
//   Operational Scope eos_workforce.employee_operational_scopes (current) -- WAREHOUSE / REORDER_QUEUE / MOBILE (truck)
//   Application user  eos_policy.employee_principal_links (active)
//   Security Roles    eos_policy.user_role_assignments (active), with scope -- ONLY for a caller holding
//                     admin.principalAccess.read (the same gate as the per-employee Security Role read); otherwise the column
//                     is withheld and says why, never shown empty.
//
// It computes no authority: Effective Access stays the server resolver's (explainEffectiveAccess). Filters narrow; they never widen.
// employee.record.read, decided per operating company for a scoped holder, exactly like listEmployees. Read-only.
//
// WHY IT LIVES HERE, NOT IN eosWorkforce/reads. The Workforce reads are fenced so that no Employee read ever names, produces or
// infers a Security Role (employeeRuntimeReads / employeeProfileAuthority suites). The roster is an ADMINISTRATION composition
// of two authorities -- the Employee (Workforce) and the Security Role assignment (eos_policy) -- so it lives in the
// Administration layer, reuses the Workforce read kernel for its gate and reach, and is served on the Workforce transport.
import {
  acceptOnly, refuse, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "../eosWorkforce/reads/employeeReadKernel";
import { directoryItemOf, EMPLOYEE_DIRECTORY_COLUMNS, type EmployeeDirectoryItem } from "../eosWorkforce/reads/employeeRecordProjection";
import { EMPLOYEE_RECORD_READ, EMPLOYMENT_STATUSES } from "../eosWorkforce/reads/employeeDirectoryReads";

export const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";
export const WORKFORCE_ROSTER_LIMIT = 500;

/**
 * Roster ordering (UI corrections package, 2026-10-08). The DEFAULT is Last Name A-Z, then First Name A-Z, then the Employee id
 * as the deterministic tie-breaker, over the COMPLETE authorized match set -- sorted BEFORE the bound is applied, so a truncated
 * page is the first N of the sorted whole, never a sorted slice of an arbitrary N. A column sort is the same: the server orders
 * the whole authorized set. Ordering only; it narrows and widens nothing.
 */
export const WORKFORCE_ROSTER_SORT_KEYS = Object.freeze(["name", "employeeNumber", "jobRole", "securityRoles", "operatingCompany", "status", "scope", "manager"] as const);
export type WorkforceRosterSortKey = typeof WORKFORCE_ROSTER_SORT_KEYS[number];

export interface WorkforceRosterItem extends EmployeeDirectoryItem {
  readonly jobRole: { readonly id: string; readonly label: string; readonly since: string } | null;
  readonly manager: { readonly employeeId: string; readonly displayName: string | null } | null;
  readonly workEligibility: readonly string[];
  readonly operationalScopes: readonly { readonly scopeType: string; readonly scopeId: string; readonly label: string | null }[];
  readonly applicationUser: "LINKED" | "UNLINKED";
  /** The linked Principal id -- ONLY for a caller holding admin.principalAccess.read (else null), for Security Role assignment. */
  readonly principalId: string | null;
  /** null when the caller may not read Security Role assignments (see securityRolesWithheld). */
  readonly securityRoles: readonly { readonly roleKey: string; readonly name: string; readonly scopeType: string; readonly scopeValue: string | null }[] | null;
  /** The governed name parts the default order uses (null when the Employee record has none). */
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface WorkforceRoster {
  readonly items: readonly WorkforceRosterItem[];
  readonly total: number;
  readonly truncated: boolean;
  readonly securityRolesWithheld: string | null;
  /** The order actually applied: the default (name ascending) unless the caller asked for a column. */
  readonly sort: { readonly key: WorkforceRosterSortKey; readonly direction: "asc" | "desc"; readonly isDefault: boolean };
  readonly facets: {
    readonly jobRoles: readonly { readonly id: string; readonly label: string; readonly count: number }[];
    readonly securityRoles: readonly { readonly roleKey: string; readonly name: string; readonly count: number }[] | null;
    readonly operatingCompanies: readonly { readonly id: string; readonly count: number }[];
    readonly statuses: readonly { readonly status: string; readonly count: number }[];
  };
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const text = (v: unknown, field: string, max = 120): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) refuse("FILTER_INVALID", "INVALID_INPUT", `${field} must be a non-empty string`);
  return (v as string).trim();
};

export function listWorkforceRoster(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<WorkforceRoster> {
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["jobRoleId", "securityRoleKey", "employmentStatus", "operatingCompanyId", "scopeType", "noJobRole", "query", "sort", "limit"]);
      const status = text(input?.employmentStatus, "employmentStatus");
      if (status && !(EMPLOYMENT_STATUSES as readonly string[]).includes(status)) refuse("FILTER_INVALID", "INVALID_INPUT", `employmentStatus must be one of ${EMPLOYMENT_STATUSES.join(", ")}`);
      const scopeType = text(input?.scopeType, "scopeType");
      if (scopeType && !["WAREHOUSE", "REORDER_QUEUE", "MOBILE"].includes(scopeType)) refuse("FILTER_INVALID", "INVALID_INPUT", "scopeType must be WAREHOUSE, REORDER_QUEUE or MOBILE");
      if (input?.noJobRole !== undefined && typeof input.noJobRole !== "boolean") refuse("FILTER_INVALID", "INVALID_INPUT", "noJobRole must be a boolean");
      const securityRoleKey = text(input?.securityRoleKey, "securityRoleKey");
      if (securityRoleKey && !actor.capabilities.has(PRINCIPAL_ACCESS_READ)) {
        refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `filtering by Security Role requires ${PRINCIPAL_ACCESS_READ}`);
      }
      return { jobRoleId: text(input?.jobRoleId, "jobRoleId"), securityRoleKey, status, operatingCompanyId: text(input?.operatingCompanyId, "operatingCompanyId"),
        scopeType, noJobRole: input?.noJobRole === true, query: text(input?.query, "query", 100), sort: rosterSortOf(input?.sort), limit: limitOf(input?.limit) };
    },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, f, reach) => {
      const roles = actor.capabilities.has(PRINCIPAL_ACCESS_READ);
      const pattern = f.query ? `%${f.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const { rows } = await db.query(
        `WITH roster AS (
           SELECT ${EMPLOYEE_DIRECTORY_COLUMNS},
                  ja.job_role_id, jr.display_name AS job_role_label, ja.effective_from AS job_role_since,
                  rr.manager_employee_id, me.display_name AS manager_name,
                  l.principal_id
             FROM eos_workforce.employees e
             LEFT JOIN eos_workforce.employee_job_role_assignments ja ON ja.tenant_id = e.tenant_id AND ja.employee_id = e.id AND ja.effective_to IS NULL
             LEFT JOIN eos_workforce.job_roles jr ON jr.tenant_id = ja.tenant_id AND jr.id = ja.job_role_id
             LEFT JOIN eos_workforce.employee_reporting_relationships rr ON rr.tenant_id = e.tenant_id AND rr.employee_id = e.id AND rr.effective_to IS NULL
             LEFT JOIN eos_workforce.employees me ON me.tenant_id = rr.tenant_id AND me.id = rr.manager_employee_id
             LEFT JOIN eos_policy.employee_principal_links l ON l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active'
            WHERE e.tenant_id = $1
              AND ($2::text[] IS NULL OR e.operating_company_id = ANY($2::text[])))
         SELECT r.*,
                COALESCE((SELECT array_agg(w.qualification_code ORDER BY w.qualification_code) FROM eos_workforce.employee_work_eligibility w
                           WHERE w.tenant_id = $1 AND w.employee_id = r.id AND w.effective_to IS NULL), '{}') AS eligibility,
                COALESCE((SELECT json_agg(json_build_object('scopeType', s.scope_type, 'scopeId', s.scope_id,
                                  'label', COALESCE(t.display_label, ml.display_label, s.scope_id)) ORDER BY s.scope_type, s.scope_id)
                            FROM eos_workforce.employee_operational_scopes s
                            LEFT JOIN eos_ops.trucks t ON s.scope_type = 'MOBILE' AND t.tenant_id = s.tenant_id AND t.mobile_location_id = s.scope_id
                            LEFT JOIN eos_ops.mobile_locations ml ON s.scope_type = 'MOBILE' AND ml.tenant_id = s.tenant_id AND ml.location_id = s.scope_id
                           WHERE s.tenant_id = $1 AND s.employee_id = r.id AND s.effective_to IS NULL), '[]') AS scopes,
                CASE WHEN $3::boolean AND r.principal_id IS NOT NULL THEN
                  COALESCE((SELECT json_agg(json_build_object('roleKey', ro.key, 'name', ro.name, 'scopeType', a.scope_type, 'scopeValue', a.scope_value)
                                   ORDER BY ro.key, a.scope_type, a.scope_value)
                              FROM eos_policy.user_role_assignments a JOIN eos_policy.roles ro ON ro.id = a.role_id AND ro.tenant_id = a.tenant_id
                             WHERE a.tenant_id = $1 AND a.principal_id = r.principal_id AND a.status = 'active'), '[]')
                END AS security_roles
           FROM roster r
          ORDER BY r.id`,
        [tenantId, reach.global ? null : [...reach.operatingCompanyIds], roles],
      );
      const all: WorkforceRosterItem[] = rows.map((r) => ({
        ...directoryItemOf(r),
        jobRole: r.job_role_id ? { id: String(r.job_role_id), label: String(r.job_role_label ?? r.job_role_id), since: iso(r.job_role_since)! } : null,
        manager: r.manager_employee_id ? { employeeId: String(r.manager_employee_id), displayName: r.manager_name ?? null } : null,
        workEligibility: (r.eligibility ?? []) as string[],
        operationalScopes: (r.scopes ?? []) as WorkforceRosterItem["operationalScopes"],
        applicationUser: r.principal_id ? "LINKED" : "UNLINKED",
        principalId: roles && r.principal_id ? String(r.principal_id) : null,
        securityRoles: roles ? ((r.security_roles ?? []) as NonNullable<WorkforceRosterItem["securityRoles"]>) : null,
        firstName: r.first_name ?? null,
        lastName: r.last_name ?? null,
      }));
      const facet = <K extends string>(keyOf: (i: WorkforceRosterItem) => readonly K[]) => {
        const m = new Map<K, number>();
        for (const i of all) for (const k of new Set(keyOf(i))) m.set(k, (m.get(k) ?? 0) + 1);
        return m;
      };
      const jobRoleLabels = new Map(all.filter((i) => i.jobRole).map((i) => [i.jobRole!.id, i.jobRole!.label]));
      const roleNames = new Map(all.flatMap((i) => (i.securityRoles ?? []).map((s) => [s.roleKey, s.name] as const)));
      const matches = all.filter((i) =>
        (!f.jobRoleId || i.jobRole?.id === f.jobRoleId)
        && (!f.noJobRole || i.jobRole === null)
        && (!f.securityRoleKey || (i.securityRoles ?? []).some((s) => s.roleKey === f.securityRoleKey))
        && (!f.status || i.employmentStatus === f.status)
        && (!f.operatingCompanyId || i.operatingCompanyId === f.operatingCompanyId)
        && (!f.scopeType || i.operationalScopes.some((s) => s.scopeType === f.scopeType))
        && (!pattern || [i.displayName, i.employeeNumber, i.employeeId].some((v) => v && v.toLowerCase().includes(f.query!.toLowerCase()))));
      matches.sort(rosterComparator(f.sort));
      return {
        items: matches.slice(0, f.limit),
        total: matches.length,
        truncated: matches.length > f.limit,
        securityRolesWithheld: roles ? null : `Security Roles are shown only to holders of ${PRINCIPAL_ACCESS_READ}`,
        sort: { key: f.sort.key, direction: f.sort.direction, isDefault: f.sort.isDefault },
        facets: {
          jobRoles: [...facet((i) => (i.jobRole ? [i.jobRole.id] : []))].map(([id, count]) => ({ id, label: jobRoleLabels.get(id) ?? id, count })).sort((a, b) => a.label.localeCompare(b.label)),
          securityRoles: roles ? [...facet((i) => (i.securityRoles ?? []).map((s) => s.roleKey))].map(([roleKey, count]) => ({ roleKey, name: roleNames.get(roleKey) ?? roleKey, count })).sort((a, b) => a.name.localeCompare(b.name)) : null,
          operatingCompanies: [...facet((i) => [i.operatingCompanyId])].map(([id, count]) => ({ id, count })),
          statuses: [...facet((i) => [i.employmentStatus])].map(([status, count]) => ({ status, count })),
        },
      };
    }, { recordScope: "operatingCompany" as const });
}

/** A caller may ask for FEWER rows (a typeahead asks for 8); never more than the bound. */
function limitOf(v: unknown): number {
  if (v === undefined || v === null) return WORKFORCE_ROSTER_LIMIT;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > WORKFORCE_ROSTER_LIMIT) {
    refuse("FILTER_INVALID", "INVALID_INPUT", `limit must be an integer from 1 to ${WORKFORCE_ROSTER_LIMIT}`);
  }
  return v as number;
}

function rosterSortOf(v: unknown): { key: WorkforceRosterSortKey; direction: "asc" | "desc"; isDefault: boolean } {
  if (v === undefined || v === null) return { key: "name", direction: "asc", isDefault: true };
  const o = v as Record<string, unknown>;
  if (typeof v !== "object" || Array.isArray(v) || Object.keys(o).some((k) => k !== "key" && k !== "direction")
    || !(WORKFORCE_ROSTER_SORT_KEYS as readonly unknown[]).includes(o.key) || (o.direction !== "asc" && o.direction !== "desc")) {
    refuse("FILTER_INVALID", "INVALID_INPUT", `sort must be { key: ${WORKFORCE_ROSTER_SORT_KEYS.join(" | ")}, direction: asc | desc }`);
  }
  return { key: o.key as WorkforceRosterSortKey, direction: o.direction as "asc" | "desc", isDefault: false };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Last name, then first name. An Employee with no name parts sorts by the last word of its display name. */
export function rosterNameKey(i: Pick<WorkforceRosterItem, "firstName" | "lastName" | "displayName" | "employeeId">): [string, string] {
  if (i.lastName || i.firstName) return [i.lastName ?? "", i.firstName ?? ""];
  const words = (i.displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["", ""];
  return [words[words.length - 1], words.slice(0, -1).join(" ")];
}

function columnValue(i: WorkforceRosterItem, key: WorkforceRosterSortKey): string {
  switch (key) {
    case "employeeNumber": return i.employeeNumber ?? "";
    case "jobRole": return i.jobRole?.label ?? "";
    case "securityRoles": return (i.securityRoles ?? []).map((r) => r.name).join(", ");
    case "operatingCompany": return i.operatingCompanyId;
    case "status": return i.employmentStatus;
    case "scope": return i.operationalScopes.map((s) => s.label ?? s.scopeId).join(", ");
    case "manager": return i.manager?.displayName ?? "";
    default: return "";
  }
}

/** Empty values sort last in BOTH directions; ties fall back to the default name order and then the Employee id. */
export function rosterComparator(sort: { key: WorkforceRosterSortKey; direction: "asc" | "desc" }) {
  const byName = (a: WorkforceRosterItem, b: WorkforceRosterItem) => {
    const [al, af] = rosterNameKey(a); const [bl, bf] = rosterNameKey(b);
    return collator.compare(al, bl) || collator.compare(af, bf);
  };
  const sign = sort.direction === "desc" ? -1 : 1;
  return (a: WorkforceRosterItem, b: WorkforceRosterItem): number => {
    let primary = 0;
    if (sort.key === "name") primary = sign * byName(a, b);
    else {
      const av = columnValue(a, sort.key); const bv = columnValue(b, sort.key);
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      primary = sign * collator.compare(av, bv);
      if (primary === 0) primary = byName(a, b);
    }
    return primary || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0);
  };
}

// THE GRANT-IMPACT PREVIEW ENGINE (PR 3 -- ADVISORY, READ-ONLY). Design: arch/grant-impact-preview.md, as amended by the
// independent review (findings 9-12; C3: no HMAC token -- the binding is a set of DIGESTS the commit will recompute
// under the governance lock in PR 4).
//
// ════════════════════ WHAT IT DOES ════════════════════
//
// Runs ONE of the nine authority-changing Administration commands -- the UNCHANGED command code -- on ONE checked-out
// connection inside BEGIN ... ROLLBACK, snapshots every tenant member's FULL effective authority before and after through
// the SAME resolver the runtime uses, and reports the difference. Nothing it does survives: the engine's only terminal
// statement is ROLLBACK.
//
// ════════════════════ HOW THE UNCHANGED COMMAND IS CONTAINED ════════════════════
//
//   connection      one client, READ COMMITTED (the grant-cell triggers refuse any other level), lock_timeout /
//                   statement_timeout / idle_in_transaction_session_timeout set LOCAL, the tenant governance lock taken
//                   ONCE at the top (so no Administration commit can interleave), eos_policy.preview = 'on'.
//   repository      `new PostgresPolicyRepository(simulation.pool)`: every read AND every `transact` lands on that one
//                   connection. A command's BEGIN becomes a SAVEPOINT, its COMMIT becomes "check the deferred
//                   constraints NOW, then RELEASE" (so a change whose REAL commit would fail is WOULD_REFUSE, never
//                   WOULD_APPLY), its ROLLBACK becomes ROLLBACK TO SAVEPOINT. Object-wide authority (one transact per
//                   action) therefore gets one savepoint per action -- the same per-action atomicity it has today.
//   resolver        capabilityAuthority's readers take a query-only `PolicyQueryable` (type-only widening); handed the
//                   simulation, they observe the uncommitted change.
//
// ════════════════════ NEVER COMMIT -- FOUR LAYERS ════════════════════
//
//   1. this engine issues ROLLBACK and nothing else at the end, in `finally`;
//   2. the simulation refuses (PreviewSafetyViolation, the preview aborts) any statement from the command that is not a
//      plain SELECT / INSERT / UPDATE / DELETE / WITH, and any that names NOTIFY / LISTEN, a sequence, a SESSION
//      advisory lock, a session-level set_config, dblink, large objects or backend control;
//   3. the database fence (migration 1764540000000): any row written by a transaction carrying eos_policy.preview = 'on'
//      queues a deferred check that refuses a REAL commit (PREVIEW_COMMIT_REFUSED). The simulated commit point names
//      only the non-fence deferrable constraints, never SET CONSTRAINTS ALL, so the fence fires only at a real COMMIT;
//   4. tests: the statement log (no COMMIT ever reaches the server), the fence, byte-identical table hashes.
//
// ════════════════════ PURITY ════════════════════
//
// No timers, no network, no Firebase, no logging, no module-level mutable state: the concurrency cap lives in the
// closure `createAuthorityChangePreview` returns (test/authorityPreviewPurity.test.mjs pins the import closure).
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import type { PolicyRepository } from "../adminPolicy/policyRepository";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import { capabilityKeysFor } from "../adminPolicy/administrationCapabilityGate";
import {
  ADMINISTRATOR_STAFFING_CAPABILITY,
  hasSecurityAdministrationCapability,
  isDesignatedAdministratorRole,
  isProtectedOwnerRole,
} from "../adminPolicy/administrationAuthority";
import { administrationSurfacesReadableBy } from "../adminPolicy/administrationSurfaceAuthority";
import { loadPrincipalPolicy } from "../adminPolicy/effectiveObjectAccess";
import type {
  AuthorityChangeSimulationRequest,
  AuthorityChangeSimulationResult,
  AuthorityChangeSimulator,
  AuthorityChangeSubject,
} from "../adminPolicy/authorityChangePreviewPort";
import { resolveOperationalContextForPrincipal, type PolicyQueryable } from "./capabilityAuthority";
import { postgresGrantConditionProvider } from "./entitledActionAuthority";
import { postgresPrincipalDimensionReader } from "./contextualAuthorization";
import { administrationReachDimension, grantedSurfaceKeys } from "./experienceAuthority";
import { fieldAccessFor, recordAccessFor, type ObjectFieldGroups } from "./governedFieldGroups";

// ════════════════════ the simulation ════════════════════

/** A statement the simulation will not run. Aborts the whole preview; never reported as a command refusal. */
export class PreviewSafetyViolation extends Error {
  constructor(message: string) {
    super(`PREVIEW_SAFETY_VIOLATION: ${message}`);
    this.name = "PreviewSafetyViolation";
  }
}

/** One statement as it reached the server. `origin`: the engine itself, or the simulated command / resolver. */
export interface PreviewStatement {
  readonly origin: "engine" | "command";
  readonly text: string;
}

/** A command may only read and write rows. Everything that is not a row statement is the engine's, or refused. */
const ROW_STATEMENT = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const WRITE_STATEMENT = /^\s*(?:INSERT|UPDATE|DELETE)\b/i;
const WRITE_IN_CTE = /\b(?:INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM)\b/i;
/** Effects ROLLBACK cannot undo, or that reach outside the transaction. */
const NON_TRANSACTIONAL = [
  /\bNOTIFY\b/i, /\bLISTEN\b/i, /\bpg_notify\s*\(/i,
  /\bnextval\s*\(/i, /\bsetval\s*\(/i,
  // SESSION advisory locks survive ROLLBACK; the xact-scoped ones (pg_advisory_xact_lock) are released by it.
  /\bpg_(?:try_)?advisory_(?:un)?lock(?:_shared|_all)?\s*\(/i,
  /\bdblink/i, /\blo_(?:import|export|unlink|create)\s*\(/i, /\bpg_(?:terminate|cancel)_backend\s*\(/i,
  /\bpg_(?:read|write)_(?:binary_)?file\s*\(/i, /\bCOPY\b[\s\S]*\bPROGRAM\b/i,
  // The fence marker is the engine's alone.
  /eos_policy\.preview/i,
];
/** The ONE transaction-local setting a command may make (beginAdministrationCommand). */
const ALLOWED_SET_CONFIG = /^\s*SELECT\s+set_config\(\s*'eos_policy\.administration_command'\s*,\s*'on'\s*,\s*true\s*\)\s*$/i;

const BUSY_SQLSTATES: Readonly<Record<string, "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT">> = Object.freeze({
  "55P03": "LOCK_TIMEOUT",
  "57014": "STATEMENT_TIMEOUT",
});

const isWrite = (text: string): boolean => WRITE_STATEMENT.test(text) || (/^\s*WITH\b/i.test(text) && WRITE_IN_CTE.test(text));

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

interface SimulationFrame { readonly name: string; readonly owner: object; writes: number }

/**
 * The single-connection simulation. `pool` is what the repository and the resolver receive: `query` runs on the one
 * client (guarded and logged); `connect` hands out a pseudo-client whose BEGIN / COMMIT / ROLLBACK become savepoints.
 */
export class PreviewSimulation {
  readonly log: PreviewStatement[] = [];
  /** Rows written inside a savepoint that was RELEASED (a simulated commit) or outside any savepoint. */
  committedWrites = 0;
  busy: "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT" | null = null;
  violation: PreviewSafetyViolation | null = null;
  private readonly frames: SimulationFrame[] = [];
  private sequence = 0;
  private closed = false;

  private deferrable: readonly string[] = Object.freeze([]);

  constructor(private readonly client: Pick<PoolClient, "query">) {}

  /** The deferrable constraints a simulated COMMIT checks (read from the catalog once the transaction is open). */
  armCommitPoint(names: readonly string[]): void { this.deferrable = Object.freeze([...names]); }

  /** The engine's own statements: BEGIN, SET LOCAL, the lock, savepoints, digests, ROLLBACK. */
  async engine(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.log.push(Object.freeze({ origin: "engine", text }));
    return this.send(text, values);
  }

  close(): void { this.closed = true; }

  /** What the repository and the resolver receive. */
  readonly pool = {
    query: (text: unknown, values?: readonly unknown[]) => this.command(text, values),
    connect: async () => this.pseudoClient(),
  };

  /**
   * ONE statement at a time on the one connection, in call order. The resolver and some commands issue reads with
   * Promise.all; on a single client those must be serialized here rather than handed to the driver concurrently.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private send(text: string, values: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    const run = async () => {
      try {
        const result = await this.client.query(text, values as unknown[]);
        return result as unknown as { rows: Record<string, unknown>[]; rowCount: number | null };
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        if (typeof code === "string" && BUSY_SQLSTATES[code]) this.busy ??= BUSY_SQLSTATES[code];
        throw err;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private refuse(message: string): never {
    const violation = new PreviewSafetyViolation(message);
    this.violation ??= violation;
    throw violation;
  }

  private guard(text: unknown): string {
    if (this.closed) this.refuse("the simulation is closed");
    if (typeof text !== "string") this.refuse("only plain-text statements are simulated");
    if (!ROW_STATEMENT.test(text)) this.refuse(`not a row statement: ${text.trim().split(/\s+/)[0] ?? ""}`);
    for (const pattern of NON_TRANSACTIONAL) if (pattern.test(text)) this.refuse(`non-transactional effect (${pattern.source})`);
    if (/\bset_config\s*\(/i.test(text) && !ALLOWED_SET_CONFIG.test(text)) this.refuse("set_config other than the transaction-local administration marker");
    return text;
  }

  private async command(text: unknown, values?: readonly unknown[]) {
    const sql = this.guard(text);
    this.log.push(Object.freeze({ origin: "command", text: sql }));
    const result = await this.send(sql, values ?? []);
    if (isWrite(sql)) {
      const top = this.frames[this.frames.length - 1];
      if (top) top.writes += 1; else this.committedWrites += 1;
    }
    return result;
  }

  private pseudoClient() {
    const owner = {};
    const mine = (): SimulationFrame | null => {
      for (let i = this.frames.length - 1; i >= 0; i -= 1) if (this.frames[i].owner === owner) return this.frames[i];
      return null;
    };
    const client = {
      query: async (text: unknown, values?: readonly unknown[]) => {
        if (typeof text === "string" && /^\s*BEGIN\s*$/i.test(text)) {
          if (mine()) this.refuse("a nested BEGIN on one transaction client");
          this.sequence += 1;
          const frame: SimulationFrame = { name: `preview_sim_${this.sequence}`, owner, writes: 0 };
          await this.engine(`SAVEPOINT ${frame.name}`);
          this.frames.push(frame);
          return { rows: [], rowCount: null };
        }
        if (typeof text === "string" && /^\s*COMMIT\s*$/i.test(text)) {
          const frame = mine();
          if (!frame || this.frames[this.frames.length - 1] !== frame) this.refuse("COMMIT outside the innermost simulated transaction");
          // THE SIMULATED COMMIT POINT: every DEFERRED constraint a real COMMIT would check is checked NOW -- by name,
          // never ALL (ALL would arm the never-commit fence). A violation throws here, inside the savepoint, and the
          // command's own catch sends ROLLBACK, exactly as a failed real COMMIT leaves nothing behind.
          if (this.deferrable.length > 0) {
            await this.engine(`SET CONSTRAINTS ${this.deferrable.join(", ")} IMMEDIATE`);
            await this.engine(`SET CONSTRAINTS ${this.deferrable.join(", ")} DEFERRED`);
          }
          await this.engine(`RELEASE SAVEPOINT ${frame.name}`);
          this.frames.pop();
          const parent = this.frames[this.frames.length - 1];
          if (parent) parent.writes += frame.writes; else this.committedWrites += frame.writes;
          return { rows: [], rowCount: null };
        }
        if (typeof text === "string" && /^\s*ROLLBACK\s*$/i.test(text)) {
          const frame = mine();
          if (!frame) return { rows: [], rowCount: null };
          while (this.frames.length > 0) {
            const top = this.frames.pop() as SimulationFrame;
            if (top === frame) break;
          }
          await this.engine(`ROLLBACK TO SAVEPOINT ${frame.name}`);
          await this.engine(`RELEASE SAVEPOINT ${frame.name}`);
          return { rows: [], rowCount: null };
        }
        return this.command(text, values);
      },
      release: (_err?: unknown) => undefined,
    };
    return client as unknown as PoolClient;
  }
}

// ════════════════════ effective authority -- one principal ════════════════════

/**
 * One principal's FULL effective authority, canonical and free of generated ids and clock values (review finding 9):
 * every list sorted, scoped holdings and assignments named by (Role, scope) and never by assignment id.
 */
export interface PrincipalAuthoritySnapshot {
  readonly principalId: string;
  /** RESOLVED, or the resolver's refusal (EMPLOYEE_NOT_ACCESS_ELIGIBLE, PRINCIPAL_DISABLED, NO_TENANT_MEMBERSHIP...). */
  readonly status: string;
  readonly protectedStanding: "OWNER" | "ADMINISTRATOR" | null;
  readonly heldRoleKeys: readonly string[];
  readonly scopedAssignments: readonly string[];
  readonly accessVersion: number;
  readonly hadStaleAssignment: boolean;
  readonly flat: readonly string[];
  readonly conditionallyHeld: readonly string[];
  readonly scopedHeld: readonly string[];
  readonly inertScoped: readonly string[];
  readonly protectedAdministratorKeys: readonly string[];
  readonly directGrants: readonly string[];
  readonly surfaces: readonly string[];
  /** `object.group:mode` and `object#recordAction` for every registered governed field-group definition. */
  readonly fieldGroups: readonly string[];
  /** The Administration gates: `surface:<s>`, `command:<action>`, `staffing:administratorRole`. */
  readonly administration: readonly string[];
  /** A refused principal's POLICY-level keys (what its qualifying Roles and direct grants would give). Latent only. */
  readonly latent: readonly string[];
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

const conditionTag = (condition: unknown): string => (condition === null || condition === undefined ? "" : ` [conditioned ${canonicalJson(condition)}]`);

export async function principalAuthority(
  q: PolicyQueryable,
  repo: PolicyRepository,
  tenantId: string,
  principalId: string,
  fieldGroups: readonly ObjectFieldGroups[],
): Promise<PrincipalAuthoritySnapshot> {
  const roles = await repo.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const versionRow = await repo.getAccessVersion(tenantId, principalId);
  const accessVersion = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;
  const standing = (roleKeys: readonly string[]): PrincipalAuthoritySnapshot["protectedStanding"] => {
    if (roleKeys.some((k) => isProtectedOwnerRole(roleByKey.get(k)))) return "OWNER";
    if (roleKeys.some((k) => { const r = roleByKey.get(k); return r ? isDesignatedAdministratorRole(r) : false; })) return "ADMINISTRATOR";
    return null;
  };
  let ctx;
  try {
    ctx = await resolveOperationalContextForPrincipal(repo, q, principalId, tenantId, postgresGrantConditionProvider(q));
  } catch (err) {
    if (!(err instanceof PrincipalContextError)) throw err;
    // REFUSED by principal resolution (DQ-007 ineligible employee, disabled, no membership...): it holds NOTHING at
    // runtime. The latent policy-level keys are reported so an administrator can see what a restored status would give.
    const policy = await loadPrincipalPolicy(repo, tenantId, principalId);
    const heldRoleKeys = sorted(policy.qualifyingRoleIds.map((id) => roleKeyById.get(id)).filter((k): k is string => !!k));
    const latent = await capabilityKeysFor(repo, tenantId, heldRoleKeys, principalId);
    return Object.freeze({
      principalId, status: err.refusal, protectedStanding: standing(heldRoleKeys), heldRoleKeys,
      scopedAssignments: sorted(policy.qualifyingAssignments.filter((a) => a.scopeType !== "global")
        .map((a) => `${roleKeyById.get(a.roleId) ?? a.roleId}@${a.scopeType}=${a.scopeValue ?? ""}`)),
      accessVersion, hadStaleAssignment: policy.hadStaleAssignment,
      flat: [], conditionallyHeld: [], scopedHeld: [], inertScoped: [], protectedAdministratorKeys: [], directGrants: [],
      surfaces: [], fieldGroups: [], administration: [], latent: sorted(latent),
    });
  }
  const pc = ctx.principalContext;
  const dims = postgresPrincipalDimensionReader(q);
  const employeeId = await dims.linkedEmployeeId(tenantId, principalId);
  const workEligibility = employeeId ? await dims.listWorkEligibility(tenantId, employeeId) : [];
  const operationalScopes = employeeId ? await dims.listOperationalScopes(tenantId, employeeId) : [];
  const administrationReach = await administrationReachDimension(q, tenantId, principalId);
  const surfaces = await grantedSurfaceKeys({ tenantId, principalId, capabilities: ctx.capabilities },
    { employeeId, workEligibility, operationalScopes, administrationReach });
  const fields: string[] = [];
  for (const def of fieldGroups) {
    for (const [group, access] of Object.entries(fieldAccessFor(def, ctx.capabilities))) {
      for (const mode of ["read", "create", "edit"] as const) if (access[mode]) fields.push(`${def.objectKey}.${group}:${mode}`);
    }
    for (const [action, allowed] of Object.entries(recordAccessFor(def, ctx.capabilities))) if (allowed) fields.push(`${def.objectKey}#${action}`);
  }
  // The Administration gates exactly as the mutation gate decides them (administrationCapabilityGate.capabilityKeysFor).
  const adminKeys = await capabilityKeysFor(repo, tenantId, pc.heldRoleKeys, principalId);
  const administration = [
    ...administrationSurfacesReadableBy(adminKeys).map((s) => `surface:${s}`),
    ...(["editSecurityPolicy", "assignRole"] as const).filter((a) => hasSecurityAdministrationCapability(adminKeys, a)).map((a) => `command:${a}`),
    ...(adminKeys.has(ADMINISTRATOR_STAFFING_CAPABILITY) ? ["staffing:administratorRole"] : []),
  ];
  return Object.freeze({
    principalId,
    status: "RESOLVED",
    protectedStanding: standing(pc.heldRoleKeys),
    heldRoleKeys: sorted(pc.heldRoleKeys),
    scopedAssignments: sorted((pc.scopedAssignments ?? []).map((a) => `${a.roleKey}@${a.scopeType}=${a.scopeValue ?? ""}`)),
    accessVersion: pc.accessVersion,
    hadStaleAssignment: pc.hadStaleAssignment,
    flat: sorted(ctx.capabilities),
    conditionallyHeld: sorted(ctx.conditionallyHeld),
    // NO assignment id (review finding 9: a randomUUID would make every scoped assignRole digest unique).
    scopedHeld: sorted(ctx.scopedHeld.map((h) => `${h.capabilityKey}@${h.scopeType}=${h.scopeValue} via ${h.sourceRole}${conditionTag(h.condition)}`)),
    inertScoped: sorted(ctx.inertScoped.map((h) => `${h.capabilityKey}@${h.scopeType}=${h.scopeValue ?? ""} via ${h.sourceRole} (${h.reason})`)),
    protectedAdministratorKeys: sorted(ctx.protectedAdministratorKeys),
    directGrants: sorted(ctx.directGrants.map((g) => g.capabilityKey)),
    surfaces: sorted(surfaces),
    fieldGroups: sorted(fields),
    administration: sorted(administration),
    latent: [],
  });
}

/** Every tenant member's snapshot (membership in any status), keyed by principal id, in id order. */
export async function snapshotTenantAuthority(
  q: PolicyQueryable,
  repo: PolicyRepository,
  tenantId: string,
  fieldGroups: readonly ObjectFieldGroups[],
): Promise<ReadonlyMap<string, PrincipalAuthoritySnapshot>> {
  const ids = sorted(await repo.listTenantPrincipalIds(tenantId));
  const out = new Map<string, PrincipalAuthoritySnapshot>();
  for (const id of ids) out.set(id, await principalAuthority(q, repo, tenantId, id, fieldGroups));
  return out;
}

// ════════════════════ the diff ════════════════════

const LIST_FIELDS = ["heldRoleKeys", "scopedAssignments", "flat", "conditionallyHeld", "scopedHeld", "inertScoped",
  "protectedAdministratorKeys", "directGrants", "surfaces", "fieldGroups", "administration", "latent"] as const;

export interface PrincipalAuthorityDelta {
  readonly principalId: string;
  readonly protectedStanding: "OWNER" | "ADMINISTRATOR" | null;
  readonly status: { readonly before: string; readonly after: string } | null;
  readonly accessVersion: { readonly before: number; readonly after: number } | null;
  readonly hadStaleAssignment: { readonly before: boolean; readonly after: boolean } | null;
  readonly changes: Readonly<Record<string, { readonly added: readonly string[]; readonly removed: readonly string[] }>>;
  readonly notes: readonly string[];
}

const EMPTY_SNAPSHOT = (principalId: string): PrincipalAuthoritySnapshot => Object.freeze({
  principalId, status: "NOT_A_MEMBER", protectedStanding: null, heldRoleKeys: [], scopedAssignments: [], accessVersion: 0,
  hadStaleAssignment: false, flat: [], conditionallyHeld: [], scopedHeld: [], inertScoped: [], protectedAdministratorKeys: [],
  directGrants: [], surfaces: [], fieldGroups: [], administration: [], latent: [],
});

/** One principal's delta, or null when nothing about its effective authority (or its access version) moved. */
export function diffPrincipalAuthority(before: PrincipalAuthoritySnapshot, after: PrincipalAuthoritySnapshot): PrincipalAuthorityDelta | null {
  const changes: Record<string, { added: string[]; removed: string[] }> = {};
  for (const field of LIST_FIELDS) {
    const b = new Set(before[field]);
    const a = new Set(after[field]);
    const added = [...a].filter((k) => !b.has(k)).sort();
    const removed = [...b].filter((k) => !a.has(k)).sort();
    if (added.length > 0 || removed.length > 0) changes[field] = { added, removed };
  }
  const status = before.status === after.status ? null : { before: before.status, after: after.status };
  const accessVersion = before.accessVersion === after.accessVersion ? null : { before: before.accessVersion, after: after.accessVersion };
  const hadStaleAssignment = before.hadStaleAssignment === after.hadStaleAssignment ? null
    : { before: before.hadStaleAssignment, after: after.hadStaleAssignment };
  if (Object.keys(changes).length === 0 && !status && !accessVersion && !hadStaleAssignment) return null;
  const notes: string[] = [];
  const effective = ["flat", "conditionallyHeld", "scopedHeld", "protectedAdministratorKeys", "surfaces", "fieldGroups", "administration"]
    .some((f) => f in changes);
  if (before.status !== "RESOLVED" && after.status !== "RESOLVED") {
    notes.push(`INELIGIBLE: resolution refuses this principal (${after.status}); the change is LATENT policy only and confers nothing at runtime`);
  }
  if (status) notes.push(`RESOLUTION_CHANGED: ${status.before} -> ${status.after}`);
  if (!effective && !status && accessVersion) notes.push("ACCESS_VERSION_ONLY: the access version moves; no effective authority changes");
  if (hadStaleAssignment && before.hadStaleAssignment && !after.hadStaleAssignment) {
    notes.push("STALE_REQUALIFIED: the access-version bump re-qualifies an assignment that was stale");
  }
  if ((changes.scopedHeld || changes.inertScoped) && !changes.flat) notes.push("SCOPED: the change is confined to scope-qualified holdings");
  if (changes.conditionallyHeld) notes.push("CONDITIONED: conditioned holdings are decided per record, never flat");
  const protectedStanding = before.protectedStanding ?? after.protectedStanding;
  if (protectedStanding === "OWNER" && (changes.flat?.removed.length ?? 0) > 0) notes.push("PROTECTED_OWNER_REDUCED: a protected Owner loses authority");
  if (protectedStanding === "ADMINISTRATOR" && (changes.flat?.removed.length ?? 0) > 0) notes.push("PROTECTED_ADMINISTRATOR_REDUCED: a protected Administrator loses authority");
  if (changes.administration) notes.push("ADMINISTRATION_GATES_CHANGED: what this principal may administer changes");
  return Object.freeze({ principalId: after.principalId, protectedStanding, status, accessVersion, hadStaleAssignment,
    changes: Object.freeze(changes), notes: Object.freeze(notes) });
}

/** Tenant-wide delta, principal id order. A principal present on one side only is diffed against an empty snapshot. */
export function diffTenantAuthority(
  before: ReadonlyMap<string, PrincipalAuthoritySnapshot>,
  after: ReadonlyMap<string, PrincipalAuthoritySnapshot>,
): readonly PrincipalAuthorityDelta[] {
  const ids = sorted([...before.keys(), ...after.keys()]);
  const out: PrincipalAuthorityDelta[] = [];
  for (const id of ids) {
    const d = diffPrincipalAuthority(before.get(id) ?? EMPTY_SNAPSHOT(id), after.get(id) ?? EMPTY_SNAPSHOT(id));
    if (d) out.push(d);
  }
  return Object.freeze(out);
}

// ════════════════════ digests (no generated ids, no clock values) ════════════════════

/** Canonical JSON: object keys sorted, recursively. Arrays keep their (already canonical) order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (value instanceof Map) return canonicalJson(Object.fromEntries([...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))));
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The POLICY STATE every resolver input depends on, tenant-scoped, as one digest. SEMANTIC columns only: no row id a
 * write would mint, no created/updated clock -- so an unrelated re-stamp never moves it and a real change always does
 * (including a direct exception crossing its expiry, which is a fact about now()). PR 4 recomputes it under the lock.
 */
export async function policyStateDigest(q: PolicyQueryable, tenantId: string): Promise<string> {
  const { rows } = await q.query<{ part: string; digest: string | null }>(
    `WITH parts(part, digest) AS (
       SELECT 'tenant', md5(coalesce((SELECT t.status::text FROM eos_policy.tenants t WHERE t.id = $1), ''))
       UNION ALL SELECT 'capabilities', md5(coalesce((SELECT string_agg(c.key || '|' || coalesce(c.object_key, '') || '|' || coalesce(c.action_key, '') || '|' || coalesce(c.action_kind, ''), ',' ORDER BY c.key) FROM eos_policy.capabilities c), ''))
       UNION ALL SELECT 'roles', md5(coalesce((SELECT string_agg(r.key || '|' || coalesce(r.protected::text, ''), ',' ORDER BY r.key) FROM eos_policy.roles r WHERE r.tenant_id = $1), ''))
       UNION ALL SELECT 'role_capabilities', md5(coalesce((SELECT string_agg(r.key || '|' || c.key, ',' ORDER BY r.key, c.key)
           FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
           JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1), ''))
       UNION ALL SELECT 'principal_capabilities', md5(coalesce((SELECT string_agg(pc.principal_id || '|' || c.key || '|' || coalesce(pc.expires_at::text, '')
             || '|' || (pc.expires_at IS NOT NULL AND pc.expires_at <= now())::text, ',' ORDER BY pc.principal_id, c.key)
           FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE pc.tenant_id = $1), ''))
       UNION ALL SELECT 'assignments', md5(coalesce((SELECT string_agg(a.principal_id || '|' || r.key || '|' || coalesce(a.scope_type, '') || '|'
             || coalesce(a.scope_value, '') || '|' || a.status || '|' || a.access_version_at_grant::text, ','
             ORDER BY a.principal_id, r.key, a.scope_type, a.scope_value, a.status, a.access_version_at_grant)
           FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id WHERE a.tenant_id = $1), ''))
       UNION ALL SELECT 'conditions', md5(coalesce((SELECT string_agg(g.grant_scope || '|' || g.grantor_key || '|' || g.capability_key || '|' || g.status || '|' || g.condition::text, ','
             ORDER BY g.grant_scope, g.grantor_key, g.capability_key) FROM eos_policy.capability_grant_conditions g WHERE g.tenant_id = $1), ''))
       UNION ALL SELECT 'decisions', md5(coalesce((SELECT string_agg(d.role_key || '|' || d.capability_key || '|' || d.decision || '|' || d.requires_condition::text, ','
             ORDER BY d.role_key, d.capability_key) FROM eos_policy.role_capability_decisions d WHERE d.tenant_id = $1 AND d.superseded_at IS NULL), ''))
       UNION ALL SELECT 'access_versions', md5(coalesce((SELECT string_agg(v.principal_id || '|' || v.access_version::text, ',' ORDER BY v.principal_id)
           FROM eos_policy.principal_access_versions v WHERE v.tenant_id = $1), ''))
       UNION ALL SELECT 'members', md5(coalesce((SELECT string_agg(m.principal_id || '|' || m.status || '|' || p.status, ',' ORDER BY m.principal_id)
           FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id WHERE m.tenant_id = $1), ''))
       UNION ALL SELECT 'employee_links', md5(coalesce((SELECT string_agg(l.principal_id || '|' || l.employee_id || '|' || l.status || '|' || coalesce(e.employment_status::text, ''), ','
             ORDER BY l.principal_id, l.employee_id, l.status)
           FROM eos_policy.employee_principal_links l LEFT JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
          WHERE l.tenant_id = $1), ''))
       UNION ALL SELECT 'sales_channels', md5(coalesce((SELECT string_agg(s.sales_channel::text || '|' || s.status, ',' ORDER BY s.sales_channel::text)
           FROM eos_policy.tenant_sales_channels s WHERE s.tenant_id = $1), ''))
     )
     SELECT part, digest FROM parts ORDER BY part`,
    [tenantId]);
  return sha256(canonicalJson(Object.fromEntries(rows.map((r) => [r.part, r.digest]))));
}

// ════════════════════ the engine ════════════════════

export interface AuthorityChangePreviewOptions {
  /** The shared pool. Only `connect` is used: the preview owns one client for its whole duration. */
  readonly pool: Pick<Pool, "connect">;
  /** Registered governed field-group definitions (server composition: e.g. PART_SUPPLIER_TERMS_FIELD_GROUPS). */
  readonly fieldGroups?: readonly ObjectFieldGroups[];
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
  /** Concurrent previews per process (default 2): previews never starve operational traffic of pool slots. */
  readonly maxConcurrent?: number;
  /** Test seam: observe each attempt's statement log (the never-commit proof). */
  readonly onStatements?: (log: readonly PreviewStatement[]) => void;
}

const positiveInt = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;

interface ActionOutcome { readonly actionKey: string; readonly capabilityKey: string; readonly outcome: string; readonly refusalCode: string | null }

/** A stable code for a command's refusal: the governed code when there is one, else the error class / SQLSTATE. */
export function refusalCodeOf(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown; severity?: unknown; constructor?: { name?: string } } | null;
  if (e && typeof e.severity === "string" && typeof e.code === "string") return `SQLSTATE_${e.code}`;
  if (e && typeof e.code === "string" && /^[A-Z][A-Z_]+$/.test(e.code)) return e.code;
  const name = e?.constructor?.name ?? (typeof e?.name === "string" ? e.name : "");
  if (name === "AdministrationCapabilityDeniedError" || name === "AdministrationDeniedError") return "FORBIDDEN";
  if (name === "PolicyValidationError") return "INVALID_INPUT";
  if (name === "PolicyStoreError") return "CONFLICT";
  return "INTERNAL";
}

function perActionOf(result: unknown): readonly ActionOutcome[] | null {
  const actions = (result as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return null;
  return Object.freeze(actions.map((a: { actionKey: string; capabilityKey: string; outcome: string; refusal: string | null }) => Object.freeze({
    actionKey: a.actionKey, capabilityKey: a.capabilityKey, outcome: a.outcome,
    refusalCode: typeof a.refusal === "string" ? (a.refusal.split(":")[0] ?? "").trim() : null,
  })));
}

async function readDeferrableConstraints(engine: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>): Promise<string[]> {
  // Every DEFERRABLE constraint a real COMMIT would check on the governed schema -- read from the catalog, not pinned,
  // so a newly added one is honoured by the simulation the moment it exists -- EXCEPT the never-commit fence.
  const { rows } = await engine(
    `SELECT DISTINCT n.nspname AS schema_name, c.conname AS constraint_name
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.condeferrable AND n.nspname IN ('eos_policy', 'eos_workforce') AND c.conname <> 'preview_never_commits'
      ORDER BY 1, 2`);
  return rows.map((r) => `${quoteIdent(String(r.schema_name))}.${quoteIdent(String(r.constraint_name))}`);
}

async function subjectHolders(q: PolicyQueryable, tenantId: string, subject: AuthorityChangeSubject | null): Promise<readonly string[]> {
  if (!subject) return [];
  if (subject.kind === "PRINCIPAL") return [subject.principalId];
  if (subject.kind === "ROLE_ID") {
    const { rows } = await q.query<{ principal_id: string }>(
      `SELECT DISTINCT principal_id FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND role_id = $2`, [tenantId, subject.roleId]);
    return sorted([subject.principalId, ...rows.map((r) => r.principal_id)]);
  }
  if (subject.kind === "ASSIGNMENT") {
    const { rows } = await q.query<{ principal_id: string }>(
      `SELECT principal_id FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND id = $2`, [tenantId, subject.assignmentId]);
    return sorted(rows.map((r) => r.principal_id));
  }
  const { rows } = await q.query<{ principal_id: string }>(
    `SELECT DISTINCT a.principal_id FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND r.key = $2`, [tenantId, subject.roleKey]);
  return sorted(rows.map((r) => r.principal_id));
}

type AttemptResult =
  | { readonly kind: "DONE"; readonly result: AuthorityChangeSimulationResult }
  | { readonly kind: "UNSTABLE" };

/**
 * Compose the preview over the shared pool. The returned simulator is what `AdminApiDeps.previewAuthorityChange`
 * receives; its concurrency cap lives in THIS closure (no module state).
 */
export function createAuthorityChangePreview(options: AuthorityChangePreviewOptions): AuthorityChangeSimulator {
  const fieldGroups = Object.freeze([...(options.fieldGroups ?? [])]);
  const lockTimeoutMs = positiveInt(options.lockTimeoutMs, 3_000);
  const statementTimeoutMs = positiveInt(options.statementTimeoutMs, 10_000);
  const idleTimeoutMs = positiveInt(options.idleInTransactionTimeoutMs, 30_000);
  const maxConcurrent = positiveInt(options.maxConcurrent, 2);
  let active = 0;

  const busy = (reason: NonNullable<AuthorityChangeSimulationResult["busy"]>["reason"]): AuthorityChangeSimulationResult =>
    Object.freeze({ outcome: "PREVIEW_BUSY", error: null, busy: Object.freeze({ reason }), report: Object.freeze({ retryable: true }) });

  async function attempt(client: PoolClient, request: AuthorityChangeSimulationRequest): Promise<AttemptResult> {
    const tenantId = request.actor.tenantId;
    const simulation = new PreviewSimulation(client);
    try {
      await simulation.engine("BEGIN ISOLATION LEVEL READ COMMITTED");
      await simulation.engine(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await simulation.engine(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
      await simulation.engine(`SET LOCAL idle_in_transaction_session_timeout = '${idleTimeoutMs}ms'`);
      await simulation.engine(`SELECT set_config('eos_policy.preview', 'on', true)`);
      // The SAME governance lock every Administration command and the catalog reconcile take (postgresPolicyRepository
      // beginAdministrationCommand), held for the whole preview: no Administration commit interleaves with it.
      await simulation.engine(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
      simulation.armCommitPoint(await readDeferrableConstraints((text, values) => simulation.engine(text, values)));
      // The engine's own reads (state digest, holders): logged, unguarded.
      const q: PolicyQueryable = { query: ((text: string, values?: unknown[]) => simulation.engine(text, values ?? [])) as unknown as PolicyQueryable["query"] };
      // The command, the repository and the resolver read and write through the GUARDED path -- they are what is contained.
      const sim = simulation.pool as unknown as Pick<Pool, "query" | "connect">;
      const reader: PolicyQueryable = sim;
      const repo = new PostgresPolicyRepository(sim);

      await simulation.engine("SAVEPOINT preview_base");
      const stateBefore = await policyStateDigest(q, tenantId);
      const holders = await subjectHolders(q, tenantId, request.subject);
      const before = await snapshotTenantAuthority(reader, repo, tenantId, fieldGroups);

      let threw = false;
      let error: unknown = null;
      let result: unknown = null;
      try {
        result = await request.run(repo);
      } catch (err) {
        threw = true;
        error = err;
      }
      if (simulation.violation) throw simulation.violation;
      if (simulation.busy) return { kind: "DONE", result: busy(simulation.busy) };
      const after = !threw ? await snapshotTenantAuthority(reader, repo, tenantId, fieldGroups) : before;
      if (simulation.violation) throw simulation.violation;
      if (simulation.busy) return { kind: "DONE", result: busy(simulation.busy) };
      const writes = simulation.committedWrites;

      // Undo the simulated change, then re-read the state under READ COMMITTED: a non-Administration writer (an
      // employment status, a membership) is not blocked by the governance lock. A preview of a moving state is retried.
      await simulation.engine("ROLLBACK TO SAVEPOINT preview_base");
      const stateAfter = await policyStateDigest(q, tenantId);
      if (stateAfter !== stateBefore) return { kind: "UNSTABLE" };

      const outcome = threw ? "WOULD_REFUSE" : writes > 0 ? "WOULD_APPLY" : "NO_OP";
      const affected = threw ? [] : diffTenantAuthority(before, after);
      const perAction = threw ? null : perActionOf(result);
      const refusalCode = threw ? refusalCodeOf(error) : null;
      const affectedIds = new Set(affected.map((d) => d.principalId));
      const unaffectedHolders = holders.filter((id) => !affectedIds.has(id)).length;
      const beforeDigest = sha256(canonicalJson([...before.values()]));
      const impactDigest = sha256(canonicalJson({ operation: request.operation, outcome, refusalCode, perAction, affected }));
      const inputDigest = sha256(canonicalJson({ operation: request.operation, input: request.input }));
      const protectedAffected = {
        owners: affected.filter((d) => d.protectedStanding === "OWNER").length,
        administrators: affected.filter((d) => d.protectedStanding === "ADMINISTRATOR").length,
      };
      const report: Record<string, unknown> = {
        operation: request.operation,
        perAction,
        affectedCount: affected.length,
        unaffectedHolders,
        protectedAffected,
        detail: request.detail ? "FULL" : "COUNTS_ONLY",
        digests: { inputDigest, policyStateDigest: stateBefore, beforeDigest, impactDigest },
      };
      if (request.detail) {
        // DETAIL (admin.principalAccess.read): before/after full effective authority + the delta + notes -- except a
        // protected Owner or Administrator, who is reported as a DELTA only (review finding 10).
        report.affected = affected.map((d) => {
          const isProtected = d.protectedStanding !== null;
          return Object.freeze({
            ...d,
            before: isProtected ? null : before.get(d.principalId) ?? null,
            after: isProtected ? null : after.get(d.principalId) ?? null,
          });
        });
      }
      return { kind: "DONE", result: Object.freeze({ outcome, error, busy: null, report: Object.freeze(report) }) };
    } finally {
      simulation.close();
      try {
        await simulation.engine("ROLLBACK");
      } finally {
        options.onStatements?.(Object.freeze([...simulation.log]));
      }
    }
  }

  return async function previewAuthorityChange(request: AuthorityChangeSimulationRequest): Promise<AuthorityChangeSimulationResult> {
    if (active >= maxConcurrent) return busy("CONCURRENCY");
    active += 1;
    let client: PoolClient;
    try {
      client = await options.pool.connect();
    } catch {
      active -= 1;
      return busy("POOL");
    }
    let destroy: Error | undefined;
    // A backend that dies mid-preview (terminated, network loss) emits 'error' on the checked-out client; without a
    // listener that is an uncaught exception for the whole process. Recorded here, and the client is destroyed.
    const onClientError = (err: Error) => { destroy ??= err; };
    client.on("error", onClientError);
    try {
      for (let i = 0; i < 2; i += 1) {
        let outcome: AttemptResult;
        try {
          outcome = await attempt(client, request);
        } catch (err) {
          const code = (err as { code?: unknown })?.code;
          if (typeof code === "string" && BUSY_SQLSTATES[code]) return busy(BUSY_SQLSTATES[code]);
          throw err;
        }
        if (outcome.kind === "DONE") return outcome.result;
      }
      return busy("UNSTABLE");
    } catch (err) {
      // A client whose ROLLBACK failed is destroyed, never returned to the pool (design F-6).
      destroy = err instanceof Error ? err : new Error(String(err));
      throw err;
    } finally {
      active -= 1;
      client.removeListener("error", onClientError);
      client.release(destroy);
    }
  };
}

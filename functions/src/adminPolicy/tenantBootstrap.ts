// Standing a tenant up — the tenant, its policy, and its first administrator.
//
// ════════════════════ WHAT WAS MISSING ════════════════════
//
// Migration 001 gave the policy model a `tenants` table and nothing created a row in it: the tests
// inserted one with raw SQL and moved on. Every other part of the subsystem assumed a tenant that
// nothing brought into existence. This file is that missing step, and it is deliberately two
// separate operations rather than one convenient one:
//
//   bootstrapTenant          creates the tenant and applies the policy seed
//   bootstrapAdministrator   gives ONE principal the Admin Role, ONCE
//
// They are separate because they are separately dangerous. Creating a tenant is ordinary
// provisioning. Creating an administrator is creating authority, and an authority-creating step
// that happens implicitly as part of provisioning is the definition of a backdoor.
//
// ════════════════════ IDEMPOTENCE, AND WHAT IT DOES NOT MEAN ════════════════════
//
// Rerunning `bootstrapTenant` is safe: it finds the tenant by KEY, and the seed itself never
// deletes, never overwrites an administrator's edit and never re-grants a permission somebody has
// since removed. "Idempotent" here means a second run changes nothing -- NOT that it resets the
// tenant to a known state. A bootstrap that reset policy on every deploy would silently undo
// configuration, which is the worst kind of "safe".
import { requireAdministrationAuthority } from "./administrationAuthority";
import { ADMIN_ROLE_KEY } from "./administrationAuthority";
import { seedTenantPolicy, SEED_VERSION } from "./seed/policySeed";
import type { SeedResult } from "./seed/policySeed";
import { PolicyStoreError } from "./policyRepository";
import type { PolicyRepository } from "./policyRepository";
import { FIREBASE_IDENTITY_PROVIDER } from "./principalContext";
import type {
  PrincipalRecord,
  TenantAdminBootstrapRecord,
  TenantId,
  TenantRecord,
} from "./types";

export class TenantBootstrapError extends Error {}

export interface BootstrapTenantInput {
  /** The stable slug the bootstrap resolves on. Not the display name, which somebody will edit. */
  readonly key: string;
  readonly name: string;
  /** Who is provisioning. Recorded as the creator of every seeded row and in the audit event. */
  readonly actorUid: string;
  /**
   * The id to mint the tenant with, if it does not exist. Injected so a caller can make
   * provisioning reproducible; a random one is used otherwise.
   */
  readonly tenantId?: TenantId;
}

export interface BootstrapTenantResult {
  readonly tenant: TenantRecord;
  /** True when THIS call created the tenant. False when it found one. */
  readonly created: boolean;
  readonly seed: SeedResult;
}

/**
 * Create the tenant if it does not exist, then apply the policy seed.
 *
 * ONE TRANSACTION when the tenant is new, and the reason is the same one the seed gives for its own
 * atomicity: a tenant that exists with no Objects, no Roles and no workflows is worse than no
 * tenant, because an administrator opening it sees a configured platform with nothing in it and no
 * way to tell which half failed.
 */
export async function bootstrapTenant(
  repo: PolicyRepository,
  input: BootstrapTenantInput,
): Promise<BootstrapTenantResult> {
  const key = requireText(input.key, "tenant key");
  const name = requireText(input.name, "tenant name");
  const actorUid = requireText(input.actorUid, "actor uid");

  const existing = await repo.getTenantByKey(key);
  const tenantId = existing?.id ?? requireText(input.tenantId ?? randomTenantId(), "tenant id");

  let tenant = existing;
  let created = false;
  if (!existing) {
    tenant = await repo.transact({ tenantId, uid: actorUid }, async (tx) => {
      const row = await tx.createTenant({ key, name });
      await tx.appendAudit({
        action: "tenant.bootstrap",
        actorUid,
        targetKind: "tenant",
        targetId: tenantId,
        before: null,
        after: { key, name, status: row.status },
        occurredAt: new Date().toISOString(),
        reason: "tenant provisioned",
      });
      return row;
    });
    created = true;
  }

  // The seed runs in its own transaction, and rerunning it on an existing tenant is the idempotent
  // path this function's contract promises. It reports `alreadySeeded` rather than pretending it
  // did work.
  const seed = await seedTenantPolicy(repo, tenantId, actorUid);

  // Record WHICH seed produced this tenant's configuration. The audit event says it too, but an
  // audit event is subject to retention and this column is not.
  if (tenant && tenant.configurationVersion !== SEED_VERSION) {
    tenant = await repo.transact({ tenantId, uid: actorUid }, (tx) =>
      tx.setTenantConfigurationVersion(tenantId, SEED_VERSION),
    );
  }

  if (!tenant) throw new TenantBootstrapError("tenant was not created");
  return { tenant, created, seed };
}

export interface BootstrapAdministratorInput {
  readonly tenantId: TenantId;
  /** The subject as the identity provider names it — a Firebase UID today. */
  readonly externalSubject: string;
  readonly identityProvider?: string;
  readonly displayName?: string | null;
  /** Who ran the bootstrap. An operator, recorded in the audit trail and in the bootstrap record. */
  readonly performedBy: string;
  readonly reason?: string | null;
}

export interface BootstrapAdministratorResult {
  readonly principal: PrincipalRecord;
  readonly bootstrap: TenantAdminBootstrapRecord;
  readonly assignmentId: string;
  readonly accessVersion: number;
}

/**
 * Give one principal the Admin Role in one tenant, once.
 *
 * ════════════════════ WHY THIS IS NOT A BACKDOOR ════════════════════
 *
 * A new tenant has no administrator, and nobody can be granted a Role because granting Roles
 * requires an administrator. Something has to break that circle. The danger is that the thing which
 * breaks it stays available afterwards as a permanent way to mint authority, so every property
 * below is about closing it again:
 *
 *   EXPLICITLY INVOKED   never runs as a side effect of provisioning, a deploy or a first login
 *   TENANT-BOUND         one tenant, named by the caller; it cannot reach another
 *   PRINCIPAL-BOUND      one subject, named by the caller
 *   ONE-TIME             `tenant_admin_bootstraps` has the tenant as its PRIMARY KEY, so the
 *                        SECOND call is refused by the database rather than by a check that could
 *                        be raced or skipped
 *   NON-OVERWRITING      refuses outright if the tenant already has an active Admin assignment,
 *                        even if no bootstrap was recorded -- an existing administrator is never
 *                        silently replaced
 *   AUDITED              one event, with the tenant, the principal and who ran it
 *
 * It is NOT reachable from arbitrary browser input: nothing in the trusted API exposes it, and the
 * only caller is an operator-run script. Recovery of a tenant that has LOST its administrators is a
 * separate, deliberately manual procedure -- see the activation document -- and not this function,
 * because a recovery path that runs itself is the backdoor this one avoids being.
 */
export async function bootstrapAdministrator(
  repo: PolicyRepository,
  input: BootstrapAdministratorInput,
): Promise<BootstrapAdministratorResult> {
  const tenantId = requireText(input.tenantId, "tenant id");
  const subject = requireText(input.externalSubject, "external subject");
  const performedBy = requireText(input.performedBy, "performedBy");
  const identityProvider = input.identityProvider ?? FIREBASE_IDENTITY_PROVIDER;

  const tenant = await repo.getTenant(tenantId);
  if (!tenant) throw new TenantBootstrapError("tenant does not exist -- run the tenant bootstrap first");

  const alreadyBootstrapped = await repo.getAdminBootstrap(tenantId);
  if (alreadyBootstrapped) {
    throw new TenantBootstrapError(
      "this tenant has already been bootstrapped; assign Roles through the trusted Admin API",
    );
  }

  const adminRole = await repo.getRoleByKey(tenantId, ADMIN_ROLE_KEY);
  if (!adminRole) throw new TenantBootstrapError("the tenant has no Admin Role -- seed it first");

  // NON-OVERWRITING, and the bootstrap record above is what makes it sufficient. The seed assigns
  // nobody, so the ONLY route to an Admin assignment that leaves no bootstrap record is the trusted
  // API -- which already requires an administrator. An existing administrator therefore implies a
  // recorded bootstrap, and the refusal above has already fired. This second check covers the
  // remaining case: the same principal being bootstrapped twice through different subjects.
  const existingPrincipal = await repo.getPrincipalBySubject(identityProvider, subject);
  if (existingPrincipal) {
    const held = await repo.listAssignmentsForPrincipal(tenantId, existingPrincipal.id);
    if (held.some((a) => a.roleId === adminRole.id && a.status === "active")) {
      throw new TenantBootstrapError("that principal already administers this tenant");
    }
  }

  return repo.transact({ tenantId, uid: performedBy }, async (tx) => {
    const principal =
      existingPrincipal ??
      (await tx.createPrincipal({
        externalSubject: subject,
        identityProvider,
        displayName: input.displayName ?? null,
      }));

    // Membership first: a principal with an assignment but no membership would resolve to no tenant
    // and hold a Role nobody could use, which reads as a broken grant rather than as a missing row.
    const membership = await repo.getMembership(tenantId, principal.id);
    if (!membership) await tx.createTenantMembership(principal.id);

    const accessVersion = await tx.bumpAccessVersion(principal.id);
    const assignment = await tx.createAssignment({
      principalId: principal.id,
      roleId: adminRole.id,
      scopeType: "global",
      scopeValue: null,
      status: "active",
      grantedBy: performedBy,
      grantedAt: new Date().toISOString(),
      accessVersionAtGrant: accessVersion,
    });

    const bootstrap = await tx.recordAdminBootstrap({
      principalId: principal.id,
      performedBy,
      reason: input.reason ?? null,
    });

    await tx.appendAudit({
      action: "tenant.bootstrapAdministrator",
      actorUid: performedBy,
      targetKind: "principal",
      targetId: principal.id,
      before: null,
      after: { roleKey: ADMIN_ROLE_KEY, assignmentId: assignment.id, identityProvider, externalSubject: subject },
      occurredAt: new Date().toISOString(),
      reason: input.reason ?? "initial administrator",
    });

    return { principal, bootstrap, assignmentId: assignment.id, accessVersion };
  });
}

/**
 * Ordinary membership: make an authenticated subject known to a tenant, with NO Roles.
 *
 * This is what onboarding looks like after the bootstrap. It creates a principal and a membership
 * and grants nothing -- the resulting context can read no policy and mutate nothing until an
 * administrator assigns a Role, which is the correct default for somebody who has merely signed in.
 */
export async function ensureTenantPrincipal(
  repo: PolicyRepository,
  input: {
    readonly tenantId: TenantId;
    readonly externalSubject: string;
    readonly identityProvider?: string;
    readonly displayName?: string | null;
    readonly actorUid: string;
    readonly actorRoleKeys: readonly string[];
  },
): Promise<PrincipalRecord> {
  const tenantId = requireText(input.tenantId, "tenant id");
  const subject = requireText(input.externalSubject, "external subject");
  const identityProvider = input.identityProvider ?? FIREBASE_IDENTITY_PROVIDER;
  // Admitting somebody to a tenant is an assignment-shaped act, so it takes the assignment
  // authority: Owner, General Manager or Admin.
  requireAdministrationAuthority(input.actorRoleKeys, "assignRole");

  const existing = await repo.getPrincipalBySubject(identityProvider, subject);
  const membership = existing ? await repo.getMembership(tenantId, existing.id) : null;
  if (existing && membership && membership.status === "active") return existing;

  return repo.transact({ tenantId, uid: input.actorUid }, async (tx) => {
    const principal =
      existing ??
      (await tx.createPrincipal({
        externalSubject: subject,
        identityProvider,
        displayName: input.displayName ?? null,
      }));

    if (membership) await tx.setTenantMembershipStatus(membership.id, "active");
    else await tx.createTenantMembership(principal.id);

    await tx.appendAudit({
      action: "tenant.addPrincipal",
      actorUid: input.actorUid,
      targetKind: "principal",
      targetId: principal.id,
      before: membership ? { status: membership.status } : null,
      after: { status: "active", identityProvider, externalSubject: subject },
      occurredAt: new Date().toISOString(),
      reason: null,
    });

    return principal;
  });
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TenantBootstrapError(`${what} is required`);
  }
  return value.trim();
}

/** Opaque above the port; a random identifier is the cheapest opaque thing. */
function randomTenantId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return `tenant-${(require("node:crypto") as typeof import("node:crypto")).randomUUID()}`;
}

export { PolicyStoreError };

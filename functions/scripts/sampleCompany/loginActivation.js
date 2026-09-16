// SAMPLE COMPANY V2 -- the LOGIN ACTIVATION phase. Governed identity wiring, credential layer excluded.
//
// ============================ THE CHAIN THIS BUILDS ============================
//
//   Firebase sandbox credential (@sandbox.invalid, passwordless until the existing activation tool runs)
//        -> EOS Principal resolved by (identityProvider, externalSubject) = ("firebase", the Auth uid)
//        -> ACTIVE tenant membership
//        -> governed Employee/Principal link
//        -> the Sample Company Employee
//
// THE PROVIDER IS MEASURED, NOT GUESSED. functions/src/eosApi/server.ts:101 reads
// `identityProvider: (env.EOS_IDENTITY_PROVIDER ?? "firebase").trim()`, :111-124's verifier returns
// `{ externalSubject: decoded.uid, identityProvider }` reading ONLY the uid, and render.yaml's
// eos-api-nonprod sets no EOS_IDENTITY_PROVIDER -- so the deployed runtime resolves Principals under
// `firebase`. A Principal under `eos-synthetic-nonprod` can never be reached by a signed-in browser, which
// is exactly why the v1 fixture Principals must be SUPERSEDED rather than left beside the real ones.
//
// A FIREBASE UID IS NEVER AN EMPLOYEE ID. The uid is the Principal's external subject and nothing else; the
// Employee id is the manifest's own `synthetic-np-emp-*` value and is untouched by this phase.
//
// ============================ THE TRANSITION IS GOVERNED, NOT SURGERY ============================
//
// `employee_principal_links` declares partial unique indexes on `status = 'active'` in BOTH directions, so
// two simultaneous active links for one Employee are structurally impossible. The transition therefore uses
// the repository's own lifecycle, in order:
//
//   1. readActiveLinkForEmployee  -- what does this Employee currently resolve to?
//   2. revokeLinkForEmployee      -- the fixture link becomes status='revoked'. THE ROW STAYS: history is
//                                    preserved, never deleted for cosmetics.
//   3. establishLink              -- the login Principal becomes the active link.
//
// There is no hand-written SQL against the link table anywhere in this file.
//
// SUPERSEDED FIXTURE PRINCIPALS ARE RETIRED, NOT LEFT LOOKING ACTIVE. Their tenant membership is set to
// `disabled` through the governed transaction port (`setTenantMembershipStatus`), with an audit event, so
// `resolvePrincipalContext` refuses them with NO_TENANT_MEMBERSHIP and they stop appearing as active
// user-access personas. The Principal row and the revoked link survive as history.
//
// NO SECRET IS CREATED OR TOUCHED HERE. This module has no password parameter, no random generation and no
// credential file access. See sandboxAuthDirectory.js for why.
"use strict";

const LINK_REASON = "SAMPLE COMPANY V2: sandbox login Principal linked to its Sample Company Employee";
const RETIRE_REASON = "SAMPLE COMPANY V2: superseded by the sandbox login Principal for this Employee";

class LoginActivationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "LoginActivationError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new LoginActivationError(code, message);
};

/**
 * Ensure every interactive persona can actually sign in and resolve to its Employee.
 *
 * @param pool          a pg Pool
 * @param options       { tenantKey, performedBy, existingAdminPrincipalId, apply }
 * @param manifest      the Sample Company manifest
 * @param authDirectory the sandbox Auth directory (the real adapter, or a double in tests)
 *
 * DRY RUN BY DEFAULT: with `apply` false nothing is created in Auth and nothing is written to PostgreSQL.
 */
async function activateSampleCompanyLogins(pool, options, manifest, authDirectory, deps = {}) {
  const apply = options.apply === true;
  const { PostgresPolicyRepository } = require("../../lib/adminPolicy/postgresPolicyRepository.js");
  const { ensureTenantPrincipal } = require("../../lib/adminPolicy/tenantBootstrap.js");
  const { assignRole } = require("../../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../../lib/adminPolicy/administrationAuthority.js");
  const links = require("../../lib/employeeIdentity/employeePrincipalLinkRepository.js");

  const repo = new PostgresPolicyRepository(pool);
  const employees = new Map(manifest.employees.map((e) => [e.key, e]));
  const actorUid = options.performedBy;

  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key ${options.tenantKey}; this phase never creates one`);
  const tenantId = tenant.id;

  const admin = await repo.getPrincipal(options.existingAdminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID", "--existingAdminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const adminRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(adminRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_INVALID", "the named administrator Principal holds no Role that may assign Roles; this phase asserts no authority of its own");
  }
  const actor = { tenantId, uid: actorUid, heldRoleKeys: adminRoleKeys };

  const personas = [];
  const drift = [];
  const summary = {
    authAccountsCreated: 0, authAccountsReused: 0,
    loginPrincipalsCreated: 0, loginPrincipalsExisting: 0,
    linksTransitioned: 0, linksAlreadyCorrect: 0,
    roleAssignmentsCreated: 0, roleAssignmentsExisting: 0,
    fixturePrincipalsRetired: 0, fixturePrincipalsAlreadyRetired: 0,
    credentialsTouched: 0,
  };

  for (const p of manifest.principals) {
    const employee = employees.get(p.employee);
    const record = {
      employeeKey: p.employee,
      employeeId: employee.id,
      interactiveLogin: employee.sandboxPersona?.interactiveLogin === true,
      credentialEmail: p.loginPrincipal.credentialEmail,
      identityProvider: p.loginPrincipal.identityProvider,
      authAccount: null,
      // A uid is an operational identifier, not a secret -- but it is still a credential subject, so the
      // report carries a stable fingerprint rather than the raw value.
      subjectFingerprint: null,
      loginPrincipal: null,
      employeeLink: null,
      securityRoles: p.securityRoles,
      fixturePrincipalDisposition: null,
    };

    // ---- the ONE real administrator: reused exactly as it is.
    if (p.existingAdministrator) {
      record.authAccount = "REUSED_EXISTING_ADMINISTRATOR";
      record.loginPrincipal = "REUSED_UNCHANGED";
      record.subjectFingerprint = fingerprint(admin.externalSubject);
      const link = await links.readActiveLinkForEmployee(pool, tenantId, employee.id);
      if (link && link.principalId === admin.id) {
        record.employeeLink = "ACTIVE";
        summary.linksAlreadyCorrect += 1;
      } else if (link) {
        drift.push({ persona: p.employee, detail: `the Owner/Executive Employee is actively linked to ${link.principalId}, not to the named administrator Principal` });
        record.employeeLink = "FIXTURE_DRIFT";
      } else {
        record.employeeLink = "MISSING";
      }
      record.fixturePrincipalDisposition = "NOT_APPLICABLE";
      personas.push(record);
      continue;
    }

    if (!record.interactiveLogin) {
      // Not reachable with the current manifest (every Principal-holding persona is interactive), but the
      // rule is stated in code rather than assumed: no credential is ever created because an Employee exists.
      record.authAccount = "NOT_REQUESTED";
      personas.push(record);
      continue;
    }

    // ---- 1. the sandbox Auth account. Reuse, never delete-and-recreate.
    const email = p.loginPrincipal.credentialEmail;
    let account = await authDirectory.findByEmail(email);
    if (account === null) {
      record.authAccount = "CREATE_PASSWORDLESS";
      summary.authAccountsCreated += 1;
      if (apply) account = await authDirectory.createPasswordless({ email, displayName: p.loginPrincipal.displayName });
    } else {
      // MATERIALLY INCONSISTENT means refuse, never repair by recreation.
      if (account.disabled) {
        drift.push({ persona: p.employee, detail: `the sandbox Auth account for ${email} is DISABLED; this phase never enables, deletes or recreates an account` });
        record.authAccount = "FIXTURE_DRIFT_DISABLED";
        personas.push(record);
        continue;
      }
      if (account.email !== email) {
        drift.push({ persona: p.employee, detail: `the sandbox Auth account resolved for ${email} carries a different email` });
        record.authAccount = "FIXTURE_DRIFT_EMAIL";
        personas.push(record);
        continue;
      }
      record.authAccount = "REUSED";
      summary.authAccountsReused += 1;
    }
    if (!apply && account === null) {
      // Nothing downstream can be resolved for an account that does not exist yet; the plan says so.
      record.loginPrincipal = "CREATE";
      record.employeeLink = "TRANSITION";
      record.fixturePrincipalDisposition = "RETIRE_MEMBERSHIP";
      personas.push(record);
      continue;
    }
    record.subjectFingerprint = fingerprint(account.uid);

    // THE INVARIANT THIS PHASE EXISTS TO KEEP. A uid is a credential subject; an Employee id is a business
    // identity. Conflating them is the single failure the identity chain is designed to prevent.
    if (account.uid === employee.id) {
      refuse("UID_IS_NOT_AN_EMPLOYEE_ID", `the Auth uid for ${email} equals the Employee id ${employee.id}; a Firebase uid is only a Principal's external subject`);
    }
    if (manifest.employees.some((e) => e.id === account.uid)) {
      refuse("UID_IS_NOT_AN_EMPLOYEE_ID", `the Auth uid for ${email} collides with a Sample Company Employee id`);
    }

    // ---- 2. the login Principal, under the provider the runtime actually resolves.
    const before = await repo.getPrincipalBySubject(p.loginPrincipal.identityProvider, account.uid);
    let loginPrincipal = before;
    record.loginPrincipal = before ? "ALREADY_PRESENT" : "CREATE";
    if (before) summary.loginPrincipalsExisting += 1;
    else summary.loginPrincipalsCreated += 1;
    if (apply) {
      loginPrincipal = await ensureTenantPrincipal(repo, {
        tenantId,
        externalSubject: account.uid,
        identityProvider: p.loginPrincipal.identityProvider,
        displayName: p.loginPrincipal.displayName,
        actorUid,
        actorRoleKeys: adminRoleKeys,
      });
    }
    if (!loginPrincipal) {
      record.employeeLink = "TRANSITION";
      record.fixturePrincipalDisposition = "RETIRE_MEMBERSHIP";
      personas.push(record);
      continue;
    }

    // ---- 3. the link transition, through the governed lifecycle only.
    const current = await links.readActiveLinkForEmployee(pool, tenantId, employee.id);
    if (current && current.principalId === loginPrincipal.id) {
      record.employeeLink = "ALREADY_ACTIVE";
      summary.linksAlreadyCorrect += 1;
    } else {
      record.employeeLink = current ? "TRANSITION_FROM_FIXTURE" : "ESTABLISH";
      summary.linksTransitioned += 1;
      if (apply) {
        await transitionEmployeeLink(pool, links, {
          tenantId,
          employeeId: employee.id,
          toPrincipalId: loginPrincipal.id,
          operatingCompanyId: manifest.company.operatingCompanyId,
          assertedBy: actorUid,
        }, deps);
      }
    }

    // ---- 4. Security Roles on the AUTHENTICATING Principal. Explicit; never inferred from a Job Role.
    const held = await repo.listAssignmentsForPrincipal(tenantId, loginPrincipal.id);
    for (const key of p.securityRoles) {
      const role = roleByKey.get(key);
      if (!role) refuse("ROLE_NOT_DEFINED", `Security Role ${key} is not defined in this tenant; this phase never creates Roles`);
      const already = held.some((a) => a.status === "active" && a.roleId === role.id && (a.scopeType ?? "global") === "global");
      if (already) summary.roleAssignmentsExisting += 1;
      else {
        summary.roleAssignmentsCreated += 1;
        if (apply) await assignRole(repo, actor, { principalId: loginPrincipal.id, roleId: role.id, reason: "SAMPLE COMPANY V2: explicit Security Role assignment on the authenticating Principal" });
      }
    }

    // ---- 5. retire the superseded fixture Principal, so it stops reading as an active user-access persona.
    record.fixturePrincipalDisposition = await retireFixturePrincipal(
      repo, pool, tenantId, p.fixturePrincipal, actorUid, apply, summary,
    );
    personas.push(record);
  }

  return {
    phase: "activate-logins",
    applied: apply,
    tenantId,
    identityProvider: manifest.company.runtimeIdentityProvider,
    firebaseProjectId: authDirectory.projectId,
    summary,
    personas,
    drift,
    // THE CREDENTIAL STEP IS SOMEBODY ELSE'S, ON PURPOSE. Named here so an operator does not have to guess,
    // and so no secret-generating code lives in the Sample Company at all.
    credentialActivation: {
      performedByThisPhase: false,
      reason: "the Sample Company sets no password and generates no secret; accounts are created passwordless",
      command: manifest.sandboxCredentials.activationCommand,
      semantics: "a strong random password ONLY for a persona with none; working personas untouched; merged into the gitignored credential file; an unparseable file refused; --rotate deliberately outside this workflow",
    },
    pass: drift.length === 0,
  };
}


/**
 * Move an Employee's ACTIVE link from its fixture Principal to its login Principal, ATOMICALLY.
 *
 * ============================ WHY ONE TRANSACTION ============================
 *
 * Revoke and establish are two writes to the same fact: WHICH Principal this Employee currently is. Run as
 * two commits, a failure between them leaves the Employee with NO ACTIVE PRINCIPAL AT ALL -- the fixture
 * login already gone, the real one not yet there -- which is strictly worse than either end state and is
 * exactly the window the partial unique index cannot protect against, because at that instant nothing is
 * ambiguous, there is simply nothing. So both happen inside ONE transaction on ONE client: on any failure
 * the ROLLBACK leaves the PRIOR ACTIVE LINK ACTIVE and the Employee still resolves to somebody.
 *
 * The repository functions take a `LinkQueryable`, so the governed writers are used unchanged with a
 * PoolClient in place of the Pool. No `employee_principal_links` SQL is written by hand here.
 *
 * THE CURRENT LINK IS RE-READ INSIDE THE TRANSACTION, not trusted from the earlier read: between the plan
 * read and this write another operator could have moved it, and revoking whatever happens to be active
 * without looking would silently discard their change.
 *
 * @param deps optional injection point used by the failure-injection test to make `establishLink` fail at
 *             exactly the moment that would strand the Employee. Production passes nothing.
 */
async function transitionEmployeeLink(pool, links, input, deps = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await links.readActiveLinkForEmployee(client, input.tenantId, input.employeeId);
    if (current && current.principalId === input.toPrincipalId) {
      // Somebody else already did it. Nothing to revoke and nothing to establish.
      await client.query("COMMIT");
      return "ALREADY_ACTIVE";
    }
    if (current) await links.revokeLinkForEmployee(client, input.tenantId, input.employeeId);
    if (deps.failBeforeEstablish) await deps.failBeforeEstablish(input);
    await links.establishLink(client, {
      tenantId: input.tenantId,
      principalId: input.toPrincipalId,
      employeeId: input.employeeId,
      operatingCompanyId: input.operatingCompanyId,
      linkSource: "OPERATOR_ASSERTED",
      assertedBy: input.assertedBy,
      assertionReason: LINK_REASON,
    });
    await client.query("COMMIT");
    return current ? "TRANSITIONED" : "ESTABLISHED";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Disable the superseded fixture Principal's tenant membership through the governed transaction port.
 *
 * NOT a delete and NOT a Principal-row mutation: the Principal and its now-revoked link stay as history.
 * Disabling the MEMBERSHIP is what `resolvePrincipalContext` reads -- it filters to active memberships and
 * refuses NO_TENANT_MEMBERSHIP otherwise -- so this is the narrowest governed act that stops an obsolete
 * synthetic Principal from presenting as an active user-access persona.
 */
async function retireFixturePrincipal(repo, pool, tenantId, fixture, actorUid, apply, summary) {
  if (!fixture) return "NOT_APPLICABLE";
  const principal = await repo.getPrincipalBySubject(fixture.identityProvider, fixture.externalSubject);
  if (!principal) return "NEVER_EXISTED";
  const membership = await repo.getMembership(tenantId, principal.id);
  if (!membership) return "NO_MEMBERSHIP";
  if (membership.status !== "active") {
    summary.fixturePrincipalsAlreadyRetired += 1;
    return "ALREADY_RETIRED";
  }
  summary.fixturePrincipalsRetired += 1;
  if (apply) {
    await repo.transact({ tenantId, uid: actorUid }, async (tx) => {
      await tx.setTenantMembershipStatus(membership.id, "disabled");
      await tx.appendAudit({
        action: "sampleCompany.fixturePrincipal.retire",
        actorUid,
        targetKind: "tenantMembership",
        targetId: membership.id,
        before: { status: membership.status },
        after: { status: "disabled" },
        occurredAt: new Date().toISOString(),
        reason: RETIRE_REASON,
      });
    });
  }
  return "MEMBERSHIP_DISABLED";
}

/** A stable, non-reversing handle for a credential subject, so no report ever echoes a raw uid. */
function fingerprint(subject) {
  if (!subject) return null;
  return `subject:${require("node:crypto").createHash("sha256").update(String(subject)).digest("hex").slice(0, 12)}`;
}

module.exports = { activateSampleCompanyLogins, transitionEmployeeLink, LoginActivationError, fingerprint };

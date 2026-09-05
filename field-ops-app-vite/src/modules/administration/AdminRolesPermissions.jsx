import { useMemo, useState } from "react";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles.ts";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles.ts";
import {
  resolveRoleAccess,
  groupByDomain,
  roleObjectMatrix,
  accessDiagnostics,
} from "../../access/roleAccessModel.js";
import { VERBS, VERB_LABEL } from "../../access/objectPermissionMap.js";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../../config/capabilityActivationOverrides";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import ApprovalRequests from "./ApprovalRequests.jsx";

// ADMINISTRATION > ROLES & PERMISSIONS -- read-only Role inspector.
//
// WHAT THIS REPLACED. This surface was three paragraphs explaining why it had nothing to
// show, plus a disabled Assign control. The explanation was accurate about the ASSIGNMENT
// half -- there is still no trusted read of live principals and roleAssignments, so this
// screen genuinely cannot list who holds what.
//
// But it was answering the wrong question. "Who holds this role" needs a deployment. "What
// does this role actually GET" does not: the role definitions, the permission catalog, and
// the object mapping are all in the repo and already drive real authorization decisions.
// That question was unanswerable anywhere in the product, and it is the one that has cost
// real time -- admin holding 50 of 110 capabilities went unnoticed precisely because
// nothing rendered a role's actual reach.
//
// ACTIVATION IS PER ENVIRONMENT, and this screen has to say THAT too. `active: false` in the
// catalog does not mean inert everywhere -- it means inert unless the environment activates it,
// which is how every capability shipped under the activation programme reaches anybody at all.
// This screen originally read only the catalog, so it reported a capability as denied while the
// backend resolver -- reading the same override set -- allowed it. Data Import made that visible:
// admin.dataImport.stage/.execute are catalogue-inert, held by Administrator through the derived
// grant, and ACTIVATED in platform-sandbox. The inspector called them inert while the product ran
// them. It now asks the same question the enforcement path asks, from the same governed set.
//
// GRANT IS NOT ACTIVATION, and this screen exists largely to say so. A capability
// registered active:false DENIES FOR EVERYONE regardless of who holds it. A role can carry
// the id and still be unable to act. Drawn as one undifferentiated list, a granted-but-
// inert capability tells an administrator access exists when it does not, and sends them
// to debug the wrong layer. Effective and inert are therefore counted and rendered apart.
//
// EVERYTHING HERE IS READ-ONLY, and the ONE mutating affordance stays disabled for its own
// honest reason (below) rather than being quietly dropped -- removing it would hide that
// the capability exists and is merely unreachable from here.
const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

/**
 * This build's environment id, or null.
 *
 * Guarded exactly as diagnostics/crashDiagnostics.js guards it: the define is absent in a plain
 * node context, and an unguarded read of an undeclared global throws rather than returning
 * undefined. Naming the environment matters here -- "active" and "active because THIS
 * environment activates it" are different facts, and the second is only meaningful with the
 * environment named.
 */
const ENVIRONMENT_ID =
  typeof __APP_ENVIRONMENT__ === "object" && __APP_ENVIRONMENT__ ? (__APP_ENVIRONMENT__.id ?? null) : null;

// Roles in the Owner's roster order. Stated rather than derived so a role the business has
// named but the system has not shows up as MISSING instead of silently vanishing.
const ROSTER_ROLES = [
  { label: "Owner", id: "owner" },
  { label: "Administrator", id: "admin" },
  { label: "General Manager", id: "generalManager" },
  { label: "Sales Manager", id: "salesManager" },
  { label: "Salesperson", id: "salesperson" },
  { label: "Marketing", id: "marketingManager" },
  { label: "Service Manager", id: "fieldManager" },
  { label: "Dispatcher", id: "dispatcher" },
  { label: "Technician", id: "technician" },
  { label: "Warehouse Manager", id: "warehouseManager" },
  { label: "Warehouse Associate", id: "warehouseAssociate" },
  { label: "Purchasing Manager", id: "purchasingManager" },
  { label: "Controller", id: "controller" },
  { label: "Accounting Manager", id: "accountingManager" },
  { label: "Shop Manager", id: "shopManager" },
  { label: "Support Staff", id: "supportStaff" },
];

const ASSIGNABLE_ROLES = Object.values(COMPATIBILITY_ROLES).filter((role) => !role.privileged);

function VerbCell({ state }) {
  if (state === "noCapability") {
    // "Nobody can ever hold this" must not look like "you were not granted it" -- the
    // second invites a request for access that cannot be granted to any role.
    return (
      <span className="fo-muted" title="No capability governs this verb — it cannot be granted to any role">
        —
      </span>
    );
  }
  return (
    <span aria-label={state === "granted" ? "Granted" : "Not granted"} title={state === "granted" ? "Granted" : "Not granted"}>
      {state === "granted" ? "✓" : ""}
    </span>
  );
}

function CapabilityList({ capabilities, tone, environmentId }) {
  if (capabilities.length === 0) return <p className="fo-muted">None.</p>;
  return (
    <ul className="fo-role-caps">
      {capabilities.map((c) => (
        <li key={c.id}>
          <code>{c.id}</code>
          {tone === "inert" && <StatusPill tone="attention" label="inert" asText />}
          {/* Catalogue-inert but reachable HERE. Said on the row rather than only in the
              heading, because this is the fact that changes when the same role is read against
              production -- and an administrator planning production needs to see which lines
              would move. */}
          {c.activatedByEnvironment && (
            <StatusPill tone="info" label={environmentId ? `active in ${environmentId}` : "active in this environment"} asText />
          )}
          {c.description && <span className="fo-muted"> — {c.description}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param activationOverrides  The environment's activation set. Defaults to the governed
 *   build-time constant, which is what production and the sandbox both actually run. It is a
 *   PARAMETER so a test can render this screen as a DIFFERENT environment -- the shared vitest
 *   define is `[]` on purpose (other suites depend on that), and a screen whose environment
 *   behaviour could only be tested by changing a global would not get tested.
 */
export default function AdminRolesPermissions({ activationOverrides = CAPABILITY_ACTIVATION_OVERRIDE_SET, environmentId = ENVIRONMENT_ID } = {}) {
  // Surfaced next to the section heading so a waiting approval is visible on arrival rather
  // than only after scrolling into the queue.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [roleKey, setRoleKey] = useState("admin");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const selected = ROSTER_ROLES.find((r) => r.id === roleKey) ?? ROSTER_ROLES[1];
  // THE CURRENT ENVIRONMENT'S activation set, baked at build time from the ONE registry and
  // role-keyed -- a production bundle carries []. Passed rather than read inside the model so
  // the model stays pure and a test can hand it a different environment.
  const activation = { activationOverrides };
  const role = selected.id ? ALL_ROLES[selected.id] : null;

  const access = useMemo(() => (role ? resolveRoleAccess(role, activation) : null), [role]);
  const objects = useMemo(() => (role ? roleObjectMatrix(role) : []), [role]);
  const diagnostics = useMemo(
    () => accessDiagnostics(ROSTER_ROLES.map((r) => ALL_ROLES[r.id]).filter(Boolean), activation),
    []
  );

  const picker = (
    <div className="fo-chip-row" role="group" aria-label="Select a role">
      {ROSTER_ROLES.map((r) => {
        const defined = !!ALL_ROLES[r.id];
        return (
          <Button
            key={r.label}
            variant={r.id === roleKey ? "primary" : "secondary"}
            onClick={defined ? () => setRoleKey(r.id) : undefined}
            disabled={!defined}
            title={defined ? undefined : "Named on the roster but not defined in the system yet"}
          >
            {r.label}
            {defined ? "" : " (not defined)"}
          </Button>
        );
      })}
    </div>
  );

  return (
    <WorkspaceShell
      title="Roles & Permissions"
      density="compact"
      context={
        access ? (
          <ContextBand
            items={[
              { key: "effective", label: "Can actually do", value: access.effective.length },
              // Counted separately and never folded into the total: a granted capability
              // that denies for everyone HERE is not authority, and a single number would
              // say it was.
              { key: "inert", label: "Granted but inert", value: access.inert.length },
              // Only shown when it is non-zero, because on most roles in most environments it
              // is zero and a permanent 0 teaches a reader to stop seeing the row.
              ...(access.environmentActivated.length > 0
                ? [{ key: "envActivated", label: `Active because of ${environmentId ?? "this environment"}`, value: access.environmentActivated.length }]
                : []),
              { key: "catalog", label: "Capabilities in catalog", value: diagnostics.catalogSize },
              { key: "active", label: "Active in catalog", value: diagnostics.activeCount },
            ]}
          />
        ) : null
      }
    >
      <p className="fo-muted">
        What each role actually gets, read from the live access contracts — not from a spreadsheet of
        intent. Read-only.
      </p>

      {picker}

      {!role ? (
        <p className="fo-muted">This role is named on the roster but is not defined in the system yet.</p>
      ) : (
        <>
          <section className="fo-panel" aria-label={`${selected.label} summary`}>
            <h3>{access.roleName ?? selected.label}</h3>
            {access.description && <p className="fo-muted">{access.description}</p>}
          </section>

          <section className="fo-panel" aria-label="Capabilities this role can use">
            <h3>Can actually do ({access.effective.length})</h3>
            {access.environmentActivated.length > 0 && (
              <p className="fo-muted">
                {access.environmentActivated.length} of these are registered inactive in the catalog and
                are reachable because{" "}
                <strong>{environmentId ?? "this environment"}</strong> activates them. They are marked
                below. In an environment that does not activate them, this role cannot do them —
                so this list answers <em>here</em>, not everywhere.
              </p>
            )}
            {groupByDomain(access.effective).map((g) => (
              <div key={g.domain} className="fo-role-domain">
                <h4>{g.domain}</h4>
                <CapabilityList capabilities={g.capabilities} environmentId={environmentId} />
              </div>
            ))}
            {access.effective.length === 0 && (
              <p className="fo-muted">
                This role grants no capability that is active today. That is not necessarily wrong — a
                least-privilege baseline role is meant to look like this.
              </p>
            )}
          </section>

          {access.inert.length > 0 && (
            <section className="fo-panel" aria-label="Granted but inert">
              <h3>Granted, but denies anyway ({access.inert.length})</h3>
              <p className="fo-muted">
                These are registered inactive in the permission catalog{" "}
                <strong>and {environmentId ?? "this environment"} does not activate them</strong>, so they
                deny for <strong>everyone</strong> here regardless of who holds them. The role carries the
                grant and still cannot do the thing. Granting it again will not help — it has to be
                activated, which is an environment decision rather than a role one.
              </p>
              <CapabilityList capabilities={access.inert} tone="inert" environmentId={environmentId} />
            </section>
          )}

          {access.unknown.length > 0 && (
            <section className="fo-panel" aria-label="Grants pointing at nothing">
              <h3>Grants the catalog does not define ({access.unknown.length})</h3>
              <p className="fo-muted">
                This role names capability ids that do not exist. Shown rather than filtered out,
                because a typo and a deletion look identical once both are dropped silently.
              </p>
              <ul className="fo-role-caps">
                {access.unknown.map((id) => (
                  <li key={id}><code>{id}</code></li>
                ))}
              </ul>
            </section>
          )}

          <section className="fo-panel" aria-label="Business object reach">
            <h3>Business objects</h3>
            <p className="fo-muted">
              The same object mapping the Objects tab renders, read from this role's side. One table,
              two views.
            </p>
            <div className="fo-table-scroll">
              <table className="fo-table" aria-label={`${selected.label} object permissions`}>
                <thead>
                  <tr>
                    <th scope="col">Object</th>
                    <th scope="col">Domain</th>
                    {VERBS.map((v) => (
                      <th key={v} scope="col">{VERB_LABEL[v]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {objects.map((row) => (
                    <tr key={row.object}>
                      <td>{row.object}</td>
                      <td className="fo-muted">{row.domain}</td>
                      {VERBS.map((v) => (
                        <td key={v}><VerbCell state={row.verbs[v]} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="fo-panel" aria-label="System diagnostics">
        <h3>System diagnostics</h3>
        <p className="fo-muted">
          Findings that only appear when every role is read together — none of these are visible from
          any single role.
        </p>
        <Button type="button" variant="secondary" onClick={() => setShowDiagnostics((v) => !v)}>
          {showDiagnostics ? "Hide" : "Show"} diagnostics
        </Button>
        {showDiagnostics && (
          <>
            <h4>Capabilities nobody can use ({diagnostics.unreachable.length})</h4>
            <p className="fo-muted">
              In the catalog, granted to no role on the roster. Nothing in the product says so, which is
              how a capability reads as available when it is unreachable.
            </p>
            <ul className="fo-role-caps">
              {diagnostics.unreachable.map((u) => (
                <li key={u.id}>
                  <code>{u.id}</code>
                  {/* Doubly unavailable, and saying which stops someone "fixing" it with a
                      grant that would still deny. */}
                  {!u.active && <StatusPill tone="attention" label="also inert" asText />}
                </li>
              ))}
            </ul>

            <h4>Grants that deny anyway ({diagnostics.inertGrants.length})</h4>
            <ul className="fo-role-caps">
              {diagnostics.inertGrants.map((g) => (
                <li key={`${g.roleId}:${g.id}`}>
                  <strong>{g.roleId}</strong> → <code>{g.id}</code>
                </li>
              ))}
            </ul>

            {diagnostics.rolesWithNothing.length > 0 && (
              <>
                <h4>Roles granting nothing ({diagnostics.rolesWithNothing.length})</h4>
                <p className="fo-muted">
                  Sometimes correct — a least-privilege baseline is meant to be empty — and sometimes a
                  role that was defined and never filled in. The screen cannot tell which; a person can.
                </p>
                <ul className="fo-role-caps">
                  {diagnostics.rolesWithNothing.map((id) => (
                    <li key={id}><code>{id}</code></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="fo-panel" aria-label="Assign a role">
        <h3>Assign an already-approved Role</h3>
        <p className="fo-muted">
          Assigning a Role calls the trusted <code>assignApprovedRole</code> command, limited to
          non-privileged Roles only. It is implemented, tested, and deployed as a live Cloud Function in
          some environments (not yet in production). This form stays disabled because no trusted read
          exists yet to list real principals to act on, and no principal currently holds the access-record
          grant every real call requires — not because the backend is unbuilt. Everything above needs no
          such read, which is why it shows real content while this does not.
        </p>
        <select disabled aria-disabled="true" defaultValue="" aria-label="Select a Role">
          <option value="" disabled>
            Select a Role
          </option>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>{" "}
        {/* variant="protected", not `secondary disabled`. The explanation was already written
            above, but it was loose prose sitting NEAR the control rather than attached to it --
            nothing tied the two together for a screen reader. The protected variant is this
            codebase's existing mechanism for exactly that: it renders the lock, keeps the native
            disabled attribute, and ties a stated reason to the button via aria-describedby. The
            paragraph above stays, because it carries the governance context (the backend IS built
            and deployed) that a control-level reason should not try to hold. */}
        <Button type="button" variant="protected" reason="No trusted read of principals exists yet, and no principal holds the required access-record grant.">
          Assign Role
        </Button>
      </section>

      {/* APPROVAL REQUESTS. The one MUTATING affordance on this screen, and the reason it is here
          rather than in a script: a privileged Role grant now requires an approval from an
          authenticated Admin session, and an approval nobody can perform inside EOS is a control
          the business routes around. The section renders its own denial state -- an operator
          without approval authority sees "not available", never an empty queue that reads as
          "nothing to do". */}
      <section className="fo-panel" aria-label="Approval Requests">
        <h2>
          Approval Requests
          {pendingApprovals > 0 && (
            <StatusPill tone="attention" label={`${pendingApprovals} pending`} asText />
          )}
        </h2>
        <p className="fo-muted">
          Privileged Role grants wait here for an authenticated Admin decision. Approving is
          recorded against your signed-in account -- the approver is never supplied by the client.
        </p>
        <ApprovalRequests onPendingCountChange={setPendingApprovals} />
      </section>
    </WorkspaceShell>
  );
}

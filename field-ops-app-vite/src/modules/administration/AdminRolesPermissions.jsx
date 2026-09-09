import { useMemo, useState } from "react";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles.ts";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles.ts";
import {
  resolveRoleAccess,
  groupByDomain,
  accessDiagnostics,
} from "../../access/roleAccessModel.js";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../../config/capabilityActivationOverrides";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { RolesPermissionsSurface, NotConfiguredNotice, SourceReference } from "./AdminPolicySurfaces.jsx";
import { isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { Field } from "../../shared/ui/form";
import ApprovalRequests from "./ApprovalRequests.jsx";
import RolePolicyGrid from "./RolePolicyGrid.jsx";

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
// EVERYTHING HERE IS READ-ONLY except Approval Requests. A disabled "Assign Role" select+button
// used to sit above that queue, explaining at length why it could not act -- it asked an
// administrator to pick a principal from a list no trusted read on this surface can produce. It is
// removed rather than left disabled: a control that cannot act still reads as an affordance and
// still costs a reader the walk to discover it is not one. `assignApprovedRole` remains built and
// deployed, and per-person assignment belongs on a per-person surface, where the principal is the
// record being read rather than something to look up. What stays here is what genuinely belongs to
// a role-shaped screen: what each Role reaches, and the two-person approval queue a PRIVILEGED
// grant requires -- which is not a per-person act at all.
//
// ORDER: the OBJECT MATRIX FIRST, then the capability lists. "What can this role touch" is a
// bounded table a person can read at a glance; "which capability ids does it hold" is a
// hundreds-of-rows list. Rendering the list first buried the table under a scroll, so the page's
// most answerable question was the hardest one to reach. The lists are filterable for the same
// reason -- unfiltered they are a wall, and the question is almost always about one domain.
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

/** "12" unfiltered, "3 of 12" filtered -- the total never disappears behind a filter. */
function countLabel(shownCount, total) {
  return shownCount === total ? `${total}` : `${shownCount} of ${total}`;
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
  const [filter, setFilter] = useState("");

  const selected = ROSTER_ROLES.find((r) => r.id === roleKey) ?? ROSTER_ROLES[1];
  // THE CURRENT ENVIRONMENT'S activation set, baked at build time from the ONE registry and
  // role-keyed -- a production bundle carries []. Passed rather than read inside the model so
  // the model stays pure and a test can hand it a different environment.
  const activation = { activationOverrides };
  const role = selected.id ? ALL_ROLES[selected.id] : null;

  const access = useMemo(() => (role ? resolveRoleAccess(role, activation) : null), [role]);
  const diagnostics = useMemo(
    () => accessDiagnostics(ROSTER_ROLES.map((r) => ALL_ROLES[r.id]).filter(Boolean), activation),
    []
  );

  // The filter narrows what is SHOWN and never what is counted: `access` stays the whole truth and
  // every heading reports both numbers, so a filtered view can never be misread as the role's reach.
  const shown = useMemo(() => {
    const empty = { effective: [], inert: [], unknown: [] };
    if (!access) return empty;
    const q = filter.trim().toLowerCase();
    if (!q) return { effective: access.effective, inert: access.inert, unknown: access.unknown };
    const hit = (c) => c.id.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q);
    return {
      effective: access.effective.filter(hit),
      inert: access.inert.filter(hit),
      // `unknown` is bare ids -- it is the list of grants pointing at nothing, so there is no
      // catalog entry to carry a description.
      unknown: access.unknown.filter((id) => id.toLowerCase().includes(q)),
    };
  }, [access, filter]);

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

  const configured = isPolicyApiConfigured();

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
      {configured ? (
        <>
          {/* PRIMARY: the tenant's stored, editable policy. */}
          <RolesPermissionsSurface />
          <p className="fo-muted">
            Below: what the code does today, measured from the live access contracts. It is a
            reference for comparison, not the configuration — that is above.
          </p>
        </>
      ) : (
        <NotConfiguredNotice what="Stored role policy" />
      )}

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

          {/* THE ANSWERABLE QUESTION FIRST, and in the SAME grid the Objects page draws. A
              bounded table of objects × verbs, above the hundreds-of-rows capability lists rather
              than under them -- and now literally the same component, so a grant cannot read one
              way here and another way there. */}
          <section className="fo-panel" aria-label="Business object reach">
            <h3>Business objects and fields</h3>
            <p className="fo-muted">
              What this role can touch. C = Create, R = Read, E = Edit, D = Delete. A tick is
              granted, a blank box is not, and a dash means no capability exists for that verb — it
              cannot be granted to anyone.
            </p>
            <p className="fo-muted">
              Expand an object to see its fields. A field INHERITS its object&rsquo;s permission
              unless the role states otherwise — and no role states otherwise today, because
              field-level policy lives in the EOS policy store and that store is not yet stood up.
              Every field row below is therefore genuinely inherited rather than a placeholder. The
              grid is read-only for the same reason the rest of this page is: role definitions live
              in code, and editing them is a policy-store operation.
            </p>
            <RolePolicyGrid role={role} label={selected.label} />
          </section>

          {/* ONE filter over all three capability lists, not one box per section: the question is
              "where does this role touch inventory", and an answer split across three separately
              filtered lists would make the reader run it three times. Counts stay honest -- a
              filtered heading says "N of TOTAL" so a narrow filter can never read as a small role. */}
          <div className="fo-panel">
            <Field
              id="role-capability-filter"
              label="Filter capabilities"
              hint="Matches the capability id and its description, across all three lists below."
            >
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="e.g. inventory, workOrder, .read"
              />
            </Field>
          </div>

          <section className="fo-panel" aria-label="Capabilities this role can use">
            <h3>Can actually do ({countLabel(shown.effective.length, access.effective.length)})</h3>
            {access.environmentActivated.length > 0 && (
              <p className="fo-muted">
                {access.environmentActivated.length} of these are registered inactive in the catalog and
                are reachable because{" "}
                <strong>{environmentId ?? "this environment"}</strong> activates them. They are marked
                below. In an environment that does not activate them, this role cannot do them —
                so this list answers <em>here</em>, not everywhere.
              </p>
            )}
            {groupByDomain(shown.effective).map((g) => (
              <div key={g.domain} className="fo-role-domain">
                <h4>{g.domain}</h4>
                <CapabilityList capabilities={g.capabilities} environmentId={environmentId} />
              </div>
            ))}
            {/* A filter that matches nothing and a role that HOLDS nothing are different facts,
                and the reassuring least-privilege sentence is only true of the second. */}
            {shown.effective.length === 0 && (
              <p className="fo-muted">
                {access.effective.length > 0
                  ? "No capability here matches that filter."
                  : "This role grants no capability that is active today. That is not necessarily wrong — a least-privilege baseline role is meant to look like this."}
              </p>
            )}
          </section>

          {shown.inert.length > 0 && (
            <section className="fo-panel" aria-label="Granted but inert">
              <h3>Granted, but denies anyway ({countLabel(shown.inert.length, access.inert.length)})</h3>
              <p className="fo-muted">
                These are registered inactive in the permission catalog{" "}
                <strong>and {environmentId ?? "this environment"} does not activate them</strong>, so they
                deny for <strong>everyone</strong> here regardless of who holds them. The role carries the
                grant and still cannot do the thing. Granting it again will not help — it has to be
                activated, which is an environment decision rather than a role one.
              </p>
              <CapabilityList capabilities={shown.inert} tone="inert" environmentId={environmentId} />
            </section>
          )}

          {shown.unknown.length > 0 && (
            <section className="fo-panel" aria-label="Grants pointing at nothing">
              <h3>Grants the catalog does not define ({countLabel(shown.unknown.length, access.unknown.length)})</h3>
              <p className="fo-muted">
                This role names capability ids that do not exist. Shown rather than filtered out,
                because a typo and a deletion look identical once both are dropped silently.
              </p>
              <ul className="fo-role-caps">
                {shown.unknown.map((id) => (
                  <li key={id}><code>{id}</code></li>
                ))}
              </ul>
            </section>
          )}

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

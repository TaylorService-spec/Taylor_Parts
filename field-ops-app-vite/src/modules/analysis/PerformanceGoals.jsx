import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PERFORMANCE_GOAL_GATE } from "../../access/shellCapabilityGates.js";
import { GOAL_OUTCOME, goalAuthoringClient, newIdempotencyKey } from "../../services/eosGoalAuthoringClient.js";
import { resolveActorDisplayName, useGovernedEmployeeDirectory } from "../../hooks/useGovernedEmployeeDirectory.js";
import { formatMinorUnits } from "../../domain/money.js";
import { PageHeader, SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormActions, FormError } from "../../shared/ui/form";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import EmptyState from "../../shared/ui/EmptyState";

// ANALYSIS > GOALS (G-1, DECISIONS #G-1; resolves OD-B4-3). Where a performance goal -- a TARGET, never an actual -- is set, approved and retired.
//
// A goal is versioned and effective-dated: a draft is authored, someone OTHER than its author approves it (FIN-007, with a reason), an approved target is
// replaced by a successor that takes effect on a later date (the old one is closed, never rewritten) or retired with no successor. History stays readable.
//
// THE SERVER DECIDES, THE SCREEN OFFERS. Every control is shown only to a holder of the capability its command enforces (PERFORMANCE_GOAL_GATE); the pickers
// hold exactly what the server's options read states the caller may author for (OFFERED == ACCEPTED: the metrics they have authority over, the companies and
// warehouses they reach, the people beneath them -- never themselves); and every command re-decides on the server. A refusal is shown in the server's own words
// and nothing on screen changes. Nothing here is optimistic: the versions are re-read after every change.
//
// A figure in a target is stated with its unit: a count is a count, an amount is money in its currency -- a "5" is never five dollars by accident.

const SCOPE_LABEL = { FIRM: "Whole firm", OPERATING_COMPANY: "Operating company", LOCATION: "Warehouse", EMPLOYEE: "Employee" };
const DIRECTION_LABEL = { AT_LEAST: "At least", AT_MOST: "At most", EXACT: "Exactly" };

/** An approved target whose start is still ahead: SCHEDULED, not in force (G-1b). `today` is an ISO date, from the screen's own date source. */
const isScheduled = (g, today) => g.status === "APPROVED" && g.effectiveFrom > today;

/**
 * A replaced target that never governed a day: it was scheduled and its replacement was approved before it started. Mirrors the server's rule (neverGoverned in
 * performanceGoalReads.ts): the approved successor was approved on a UTC day before this one's start. Not stored -- derived, so the record stays as it was written.
 */
function replacedBeforeStart(g, list) {
  if (g.status !== "SUPERSEDED") return false;
  const next = list.find((s) => s.supersedesGoalId === g.goalId && s.approvedByUid && Number.isFinite(s.approvedAtMillis));
  return Boolean(next) && new Date(next.approvedAtMillis).toISOString().slice(0, 10) < g.effectiveFrom;
}

/** The status a person reads: what the version IS today, not only what was last done to it. */
function statusView(g, list, today) {
  if (g.status === "DRAFT") return { label: "Draft", tone: "attention" };
  if (g.status === "APPROVED") return isScheduled(g, today) ? { label: "Scheduled", tone: "info" } : { label: "In force", tone: "positive" };
  if (g.status === "SUPERSEDED") {
    if (replacedBeforeStart(g, list)) return { label: "Replaced before it started", tone: "muted" };
    // Replaced, but its window runs on until the day before the replacement starts: it is still the target in force.
    return g.effectiveTo !== null && g.effectiveTo >= today && g.effectiveFrom <= today
      ? { label: `In force until ${g.effectiveTo}`, tone: "positive" } : { label: "Replaced", tone: "muted" };
  }
  return { label: g.status === "RETIRED" ? "Retired" : g.status, tone: "muted" };
}

/** "12.5" / "12.50" / "12" -> whole minor units; anything else -> null (refused, never rounded to something the person did not type). */
export function toMinorUnits(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

/** A target for a person: the number with its unit and direction. */
export function describeTarget(goal) {
  // Money is stated WITH its currency, never as a bare number; a missing currency is said, not guessed.
  const value = goal.unit === "CURRENCY_MINOR" ? `${formatMinorUnits(goal.targetValue, goal.currency)} ${goal.currency ?? "(currency not stated)"}` : String(goal.targetValue);
  return `${DIRECTION_LABEL[goal.direction] ?? goal.direction} ${value}`;
}

const sentence = (res, fallback) => (res.message ? res.message : res.outcome === GOAL_OUTCOME.UNAUTHENTICATED ? "Sign in again to continue." : fallback);
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function PerformanceGoals({ hasCapability, client = goalAuthoringClient, today: todayProp }) {
  const today = todayProp ?? todayIso();
  const can = useCallback((key) => typeof hasCapability === "function" && hasCapability(key) === true, [hasCapability]);
  const [opts, setOpts] = useState({ state: "loading", data: null });
  const [target, setTarget] = useState({ metricId: "", scopeType: "", scopeId: "" });
  const [versions, setVersions] = useState({ state: "idle", list: [], target: null });
  const [composer, setComposer] = useState(null); // { supersedes: goal | null }
  const [panel, setPanel] = useState(null); // { kind: "approve" | "retire", goal }
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await client.loadOptions();
      if (!live) return;
      setOpts(res.ok ? { state: "ready", data: res.options } : { state: res.outcome === GOAL_OUTCOME.DENIED ? "denied" : "unavailable", data: null });
    })();
    return () => { live = false; };
  }, [client]);

  const data = opts.data;
  const metric = data?.metrics.find((m) => m.metricId === target.metricId) ?? null;
  const needsId = target.scopeType !== "" && target.scopeType !== "FIRM";
  const ready = metric !== null && target.scopeType !== "" && (!needsId || target.scopeId !== "");

  const actorIds = useMemo(() => [...new Set(versions.list.flatMap((g) => [g.createdByUid, g.approvedByUid]).filter(Boolean))], [versions.list]);
  const { byEmployeeId, byUserId } = useGovernedEmployeeDirectory({ employeeIds: data?.employeeIds ?? [], actorIds });
  const nameOfActor = (id) => (id ? resolveActorDisplayName(id, byUserId) : "—");
  // Names come from the server's own options (the companies and warehouses it states the caller reaches), looked up by id; an id the options do not name is
  // shown as it is, never guessed at.
  const names = useMemo(() => ({
    OPERATING_COMPANY: new Map((data?.companies ?? []).map((c) => [c.id, c.name])),
    LOCATION: new Map((data?.warehouses ?? []).map((w) => [w.id, w.name])),
  }), [data]);
  const scopeText = (type, id) => {
    if (type === "FIRM") return SCOPE_LABEL.FIRM;
    if (type === "EMPLOYEE") return byEmployeeId.get(id)?.displayName ?? id;
    return names[type]?.get(id) ?? id;
  };

  const loadVersions = useCallback(async (t) => {
    setVersions({ state: "loading", list: [], target: t });
    const res = await client.listVersions({ metricId: t.metricId, targetScopeType: t.scopeType, targetScopeId: t.scopeType === "FIRM" ? null : t.scopeId });
    setVersions(res.ok ? { state: "ready", list: res.versions, target: t } : { state: res.outcome === GOAL_OUTCOME.DENIED ? "denied" : "unavailable", list: [], target: t });
  }, [client]);

  const changed = async (message) => {
    setNotice(message);
    setPanel(null);
    setComposer(null);
    if (versions.target) await loadVersions(versions.target);
  };

  const header = (children) => (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Goals"
        description="Targets for the measures the platform can state. A target is set as a draft, approved by someone other than its author, and replaced or retired without rewriting history."
      />
      {children}
    </>
  );

  if (opts.state === "loading") return header(<LoadingState>Loading what you can set targets for…</LoadingState>);
  if (opts.state === "denied") return header(<FailureState title="Goals unavailable" message="Your role does not include setting performance goals." />);
  if (opts.state === "unavailable") return header(<FailureState title="Goals unavailable" message="Your goal options could not be loaded. Try again shortly." />);

  return header(
    <>
      {notice ? <p role="status" className="fo-muted">{notice}</p> : null}
      <section aria-label="Choose a target" className="fo-panel">
        <SectionHeader title="Choose a target" description="A target is one measure at one place: the whole firm, a company, a warehouse or a person." />
        {data.metrics.length === 0 ? (
          <EmptyState variant="filtered" title="Nothing to set targets on" message="You do not hold authority over any measure a target can be set on." />
        ) : (
          <form className="fo-form-grid" onSubmit={(e) => { e.preventDefault(); if (ready) { setNotice(null); setPanel(null); setComposer(null); loadVersions(target); } }}>
            <Field id="goal-metric" label="Measure" required>
              <select className="fo-input" value={target.metricId}
                onChange={(e) => setTarget({ metricId: e.target.value, scopeType: "", scopeId: "" })}>
                <option value="">Choose a measure</option>
                {data.metrics.map((m) => <option key={m.metricId} value={m.metricId}>{m.displayName}</option>)}
              </select>
            </Field>
            <Field id="goal-scope-type" label="For" required>
              <select className="fo-input" value={target.scopeType} disabled={!metric}
                onChange={(e) => setTarget({ ...target, scopeType: e.target.value, scopeId: "" })}>
                <option value="">Choose where it applies</option>
                {(metric?.supportedScopes ?? []).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s] ?? s}</option>)}
              </select>
            </Field>
            {target.scopeType === "OPERATING_COMPANY" ? (
              <Field id="goal-scope-company" label="Company" required>
                <select className="fo-input" value={target.scopeId} onChange={(e) => setTarget({ ...target, scopeId: e.target.value })}>
                  <option value="">Choose a company</option>
                  {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            ) : null}
            {target.scopeType === "LOCATION" ? (
              <Field id="goal-scope-warehouse" label="Warehouse" required>
                <select className="fo-input" value={target.scopeId} onChange={(e) => setTarget({ ...target, scopeId: e.target.value })}>
                  <option value="">Choose a warehouse</option>
                  {data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            ) : null}
            {target.scopeType === "EMPLOYEE" ? (
              <Field id="goal-scope-employee" label="Employee" required
                hint="You can set targets for people beneath you in the organization, never for yourself.">
                <select className="fo-input" value={target.scopeId} onChange={(e) => setTarget({ ...target, scopeId: e.target.value })}>
                  <option value="">Choose an employee</option>
                  {data.employeeIds.map((id) => <option key={id} value={id}>{byEmployeeId.get(id)?.displayName ?? id}</option>)}
                </select>
              </Field>
            ) : null}
            <FormActions>
              <Button type="submit" disabled={!ready}>Show this target</Button>
            </FormActions>
          </form>
        )}
      </section>

      {versions.state === "loading" ? <LoadingState>Loading the versions…</LoadingState> : null}
      {versions.state === "denied" ? <FailureState title="Target unavailable" message="That target is outside what you can see." /> : null}
      {versions.state === "unavailable" ? <FailureState title="Target unavailable" message="The versions could not be loaded. Try again shortly." /> : null}
      {versions.state === "ready" ? (
        <VersionsSection
          t={versions.target} metric={data.metrics.find((m) => m.metricId === versions.target.metricId)} list={versions.list} can={can}
          me={data.principalId} scopeText={scopeText} nameOfActor={nameOfActor} today={today}
          onSet={() => { setPanel(null); setComposer({ supersedes: null }); }}
          onReplace={(g) => { setPanel(null); setComposer({ supersedes: g }); }}
          onDecide={(kind, goal) => { setComposer(null); setPanel({ kind, goal }); }}
        />
      ) : null}
      {composer && versions.state === "ready" ? (
        <Composer key={composer.supersedes?.goalId ?? "new"} client={client} t={versions.target} metric={data.metrics.find((m) => m.metricId === versions.target.metricId)}
          supersedes={composer.supersedes} scheduled={composer.supersedes ? isScheduled(composer.supersedes, today) : false} today={today} onCancel={() => setComposer(null)}
          onDone={(goal) => changed(composer.supersedes
            ? (isScheduled(composer.supersedes, today)
              ? `Saved a corrective replacement draft (version ${goal.version}). Until someone else approves it, the scheduled target stands.`
              : `Saved a replacement draft (version ${goal.version}). Someone else approves it before it takes effect.`)
            : "Saved the target as a draft. Someone else approves it before it takes effect.")} />
      ) : null}
      {panel && versions.state === "ready" ? (
        <DecisionPanel key={`${panel.kind}-${panel.goal.goalId}`} client={client} kind={panel.kind} goal={panel.goal} onCancel={() => setPanel(null)}
          correcting={panel.kind === "approve" && versions.list.some((v) => v.goalId === panel.goal.supersedesGoalId && isScheduled(v, today))}
          onDone={() => changed(panel.kind === "approve" ? "Approved. The target is in force from its start date."
            : panel.goal.status === "DRAFT" ? "Discarded. The draft was never a target and is kept on record as retired."
              : "Retired. The target no longer applies; its history stays on record.")} />
      ) : null}
    </>,
  );
}

function VersionsSection({ t, metric, list, can, me, scopeText, nameOfActor, today, onSet, onReplace, onDecide }) {
  const title = `${metric?.displayName ?? t.metricId} — ${scopeText(t.scopeType, t.scopeId)}`;
  return (
    <section aria-label="Target versions" className="fo-panel">
      <SectionHeader title={title} description="Every version of this target, oldest first. A replaced or retired version stays on record with the dates it applied."
        actions={can(PERFORMANCE_GOAL_GATE.create) ? <Button variant="secondary" onClick={onSet}>Set a target</Button> : null} />
      {list.length === 0 ? (
        <EmptyState variant="filtered" title="No target set" message="Nothing has been set for this measure here yet." />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table fo-table--stack ns-table" aria-label="Target versions">
            <thead>
              <tr><th>Version</th><th>Status</th><th>Target</th><th>From</th><th>Until</th><th>Set by</th><th>Approved by</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const own = g.createdByUid === me;
                // A draft copied from the previous system cannot be approved here (its author cannot be compared with an approver): it is discarded, or set again.
                const copied = g.status === "DRAFT" && typeof g.provenance === "string" && g.provenance !== "NATIVE";
                const view = statusView(g, list, today);
                const scheduled = isScheduled(g, today);
                return (
                  <tr key={g.goalId}>
                    <td>{g.version}</td>
                    <td><StatusIndicator tone={view.tone} label={view.label} /></td>
                    <td>{describeTarget(g)}</td>
                    <td>{g.effectiveFrom}</td>
                    <td>{g.effectiveTo ?? "Open-ended"}</td>
                    <td>{nameOfActor(g.createdByUid)}</td>
                    <td>{g.approvedByUid ? nameOfActor(g.approvedByUid) : "—"}</td>
                    <td>
                      <div className="fo-btn-row">
                        {g.status === "DRAFT" && can(PERFORMANCE_GOAL_GATE.approve) && !own && !copied ? (
                          <Button variant="secondary" onClick={() => onDecide("approve", g)} aria-label={`Approve version ${g.version}`}>Approve</Button>
                        ) : null}
                        {copied && can(PERFORMANCE_GOAL_GATE.approve) ? (
                          <span className="fo-muted" role="note">Copied from the previous system, so it cannot be approved here. Discard it and set the target again.</span>
                        ) : null}
                        {g.status === "DRAFT" && can(PERFORMANCE_GOAL_GATE.approve) && own && !copied ? (
                          <span className="fo-muted" role="note">You set this one, so someone else approves it.</span>
                        ) : null}
                        {g.status === "APPROVED" && can(PERFORMANCE_GOAL_GATE.supersede) ? (
                          <Button variant="secondary" onClick={() => onReplace(g)} aria-label={`Replace version ${g.version}`}>Replace</Button>
                        ) : null}
                        {g.status === "DRAFT" && can(PERFORMANCE_GOAL_GATE.retire) ? (
                          <Button variant="secondary" onClick={() => onDecide("retire", g)} aria-label={`Discard version ${g.version}`}>Discard</Button>
                        ) : null}
                        {g.status === "APPROVED" && !scheduled && can(PERFORMANCE_GOAL_GATE.retire) ? (
                          <Button variant="secondary" onClick={() => onDecide("retire", g)} aria-label={`Retire version ${g.version}`}>Retire</Button>
                        ) : null}
                        {scheduled ? (
                          <span className="fo-muted" role="note">Starts {g.effectiveFrom}. To change it, replace it; someone else approves the replacement.</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Composer({ client, t, metric, supersedes, scheduled = false, today, onCancel, onDone }) {
  const unit = metric?.unit ?? "COUNT";
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [direction, setDirection] = useState(metric?.allowedDirections?.length === 1 ? metric.allowedDirections[0] : "");
  const [from, setFrom] = useState(supersedes ? "" : todayIso());
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // ONE key per attempt, held until the attempt is answered: a retry after a lost response is a replay, not a second draft.
  const attemptKey = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    let targetValue;
    if (unit === "CURRENCY_MINOR") {
      targetValue = toMinorUnits(value);
      if (targetValue === null || !/^[A-Z]{3}$/.test(currency)) { setError("An amount is dollars and cents (for example 12500.00) with a three-letter currency."); return; }
    } else {
      targetValue = /^\d{1,12}$/.test(value.trim()) ? Number(value.trim()) : null;
      if (targetValue === null) { setError("A target is a whole number."); return; }
    }
    if (direction === "") { setError("Choose whether the target is a minimum or a maximum."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) { setError("Choose the date the target takes effect."); return; }
    setBusy(true);
    setError(null);
    attemptKey.current = attemptKey.current ?? newIdempotencyKey("goal-create");
    const res = await client.createDraft({
      metricId: t.metricId, targetScopeType: t.scopeType, targetScopeId: t.scopeType === "FIRM" ? null : t.scopeId, targetValue, unit, direction,
      currency: unit === "CURRENCY_MINOR" ? currency : null, effectiveFrom: from, effectiveTo: to || null,
      supersedesGoalId: supersedes?.goalId ?? null, idempotencyKey: attemptKey.current,
    });
    setBusy(false);
    if (res.ok) { attemptKey.current = null; await onDone(res.goal); return; }
    // A definitive answer ends the attempt; only an unreachable / unavailable service keeps the key, so the retry is safe.
    if (res.outcome !== GOAL_OUTCOME.UNAVAILABLE) attemptKey.current = null;
    setError(sentence(res, "The target was not saved. Nothing was changed; try again."));
  };

  return (
    <form onSubmit={submit} aria-label={supersedes ? "Replace a target" : "Set a target"} className="fo-panel">
      <SectionHeader level={3} title={supersedes ? `Replace version ${supersedes.version}` : "Set a target"}
        description={supersedes
          ? (scheduled
            ? "This target has not started. The replacement takes the scheduled one's place and may start earlier or later; the target in force now continues until the day before it starts. The scheduled one stays on record and never takes effect."
            : "The new target takes effect on its start date; the current one is closed the day before.")
          : "Saved as a draft. It does not apply until someone else approves it."} />
      <Field id="goal-value" label={unit === "CURRENCY_MINOR" ? "Amount" : "Target"} required>
        <input className="fo-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {unit === "CURRENCY_MINOR" ? (
        <Field id="goal-currency" label="Currency" required>
          <input className="fo-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      ) : null}
      <Field id="goal-direction" label="Counts as met when the result is" required>
        <select className="fo-input" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">Choose</option>
          {(metric?.allowedDirections ?? []).map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d] ?? d} the target</option>)}
        </select>
      </Field>
      <Field id="goal-from" label="Takes effect on" required
        hint={supersedes ? (scheduled ? `Must be after today (${today}): a day that has passed keeps the target that governed it.` : `Must be after ${supersedes.effectiveFrom}, when the current target began.`) : undefined}>
        <input className="fo-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field id="goal-to" label="Ends on (optional)" hint="Leave blank for a target that applies until it is replaced or retired.">
        <input className="fo-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <FormError role="alert">{error}</FormError>
      <FormActions submitting={busy}>
        <Button type="submit" loading={busy}>Save draft</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </FormActions>
    </form>
  );
}

function DecisionPanel({ client, kind, goal, correcting = false, onCancel, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const attemptKey = useRef(null);
  const approving = kind === "approve";
  const discarding = !approving && goal.status === "DRAFT";

  const submit = async (e) => {
    e.preventDefault();
    if (busy || reason.trim() === "") return;
    setBusy(true);
    setError(null);
    attemptKey.current = attemptKey.current ?? newIdempotencyKey(`goal-${kind}`);
    const res = await (approving ? client.approve : client.retire)({ goalId: goal.goalId, reason, idempotencyKey: attemptKey.current });
    setBusy(false);
    if (res.ok) { attemptKey.current = null; await onDone(); return; }
    if (res.outcome !== GOAL_OUTCOME.UNAVAILABLE) attemptKey.current = null;
    setError(sentence(res, "That did not go through. Nothing was changed; try again."));
  };

  return (
    <form onSubmit={submit} aria-label={approving ? "Approve a target" : discarding ? "Discard a draft" : "Retire a target"} className="fo-panel">
      <SectionHeader level={3} title={`${approving ? "Approve" : discarding ? "Discard" : "Retire"} version ${goal.version}: ${describeTarget(goal)}`}
        description={approving ? (correcting
          ? "Approving replaces the scheduled target, which then never takes effect (it stays on record). The target in force now continues until the day before this one starts."
          : "Approving puts this target in force. If it replaces another, that one is closed the day before.")
          : discarding ? "Discarding retires a draft that was never a target. It is kept on record as retired and nothing was ever measured against it."
            : "Retiring ends this target with no replacement. The period it applied stays on record."} />
      <Field id="goal-reason" label={approving ? "Why is this approved?" : discarding ? "Why is this discarded?" : "Why is this retired?"} required>
        <textarea className="fo-input" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormError role="alert">{error}</FormError>
      <FormActions submitting={busy}>
        <Button type="submit" loading={busy} disabled={reason.trim() === ""}>{approving ? "Confirm approval" : discarding ? "Confirm discard" : "Confirm retirement"}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </FormActions>
    </form>
  );
}

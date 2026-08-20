import { useState } from "react";
import { PageHeader, SectionHeader, StatusIndicator, CompactMetric, Button } from "../../shared/ui/primitives";
import {
  RULE_OBJECTS,
  MATCH_METHODS,
  SEEDED_RULES,
  rulesForObject,
  objectsWithActiveRules,
  describeCriteria,
  strongestAction,
} from "../../domain/duplicateRules";

// Administration -> Duplicate Rules.
//
// Per docs/specifications/duplicate-detection.md: rules are DATA an admin edits
// here, never behaviour compiled into a screen. This surface shows the seeded
// ruleset -- real rules with their real criteria, actions and alert text -- so the
// model can be reviewed before the governed write path exists.
//
// EDITING IS HONESTLY DISABLED, not hidden. The `matching_rules` /
// `duplicate_rules` collections and their trusted read/write services are not
// built yet, so there is nothing to save to. Every edit control renders as
// `variant="protected"` with the reason stated, which is the same posture
// AdminRolesPermissions.jsx already uses for its ungated mutations -- a control
// that looks live and silently does nothing is the failure this codebase keeps
// finding and fixing.
//
// When those services ship, this screen's shape does not change: the seed module
// stops being what it reads, and the protected buttons become live.

const NOT_YET_EDITABLE =
  "Rule editing needs the governed rules service, which is not built yet. These are the rules the system will start with.";

function ActionSummary({ rule }) {
  const blocks = strongestAction(rule) === "block";
  return (
    <StatusIndicator tone={blocks ? "warning" : "info"}>
      {blocks ? "Blocks the save" : "Warns, still saves"}
    </StatusIndicator>
  );
}

function RuleCard({ rule }) {
  return (
    <article className="fo-duprule">
      <header className="fo-duprule__head">
        <div className="fo-duprule__identity">
          <h4 className="fo-duprule__name">{rule.name}</h4>
          <p className="fo-duprule__criteria">{describeCriteria(rule)}</p>
        </div>
        <div className="fo-duprule__state">
          <ActionSummary rule={rule} />
          {!rule.active && <StatusIndicator tone="neutral">Off</StatusIndicator>}
        </div>
      </header>

      <dl className="fo-duprule__detail">
        <dt>Matches on</dt>
        <dd>
          <ul className="fo-duprule__criteria-list">
            {rule.criteria.map((c) => (
              <li key={c.fieldId}>
                <span className="fo-duprule__field">{c.label}</span>
                <span className="fo-duprule__method">{MATCH_METHODS[c.method]?.label ?? c.method}</span>
                {/* Stated rather than assumed: two records both missing this field
                    do not count as similar. It is the commonest false-positive
                    source, so it belongs on screen, not only in the data. */}
                {!c.matchBlanks && <span className="fo-duprule__blank-note">blank values never match</span>}
              </li>
            ))}
          </ul>
        </dd>

        <dt>When someone creates</dt>
        <dd>{rule.onCreate.action === "block" ? "Blocked, with the message below" : "Allowed, with a warning"}</dd>

        <dt>When someone edits</dt>
        <dd>{rule.onEdit.action === "block" ? "Blocked, with the message below" : "Allowed, with a warning"}</dd>

        <dt>Message shown</dt>
        <dd className="fo-duprule__message">{rule.alertText}</dd>

        {rule.rationale && (
          <>
            <dt>Why</dt>
            <dd className="fo-duprule__rationale">{rule.rationale}</dd>
          </>
        )}
      </dl>

      <footer className="fo-duprule__actions">
        <Button variant="protected" reason={NOT_YET_EDITABLE}>
          Edit rule
        </Button>
        <Button variant="protected" reason={NOT_YET_EDITABLE}>
          {rule.active ? "Turn off" : "Turn on"}
        </Button>
      </footer>
    </article>
  );
}

export default function AdminDuplicateRules() {
  const [objectId, setObjectId] = useState(RULE_OBJECTS[0].id);
  const selected = RULE_OBJECTS.find((o) => o.id === objectId) ?? RULE_OBJECTS[0];
  const rules = rulesForObject(objectId);

  return (
    <div className="fo-panel">
      <PageHeader
        eyebrow="Administration"
        title="Duplicate Rules"
        description="How the system decides two records are the same, and what it does about it. Each object has its own rules."
      />

      <div className="fo-duprules__summary">
        <CompactMetric value={RULE_OBJECTS.length} label="Objects" />
        <CompactMetric value={objectsWithActiveRules()} label="With active rules" />
        <CompactMetric value={SEEDED_RULES.filter((r) => r.active).length} label="Active rules" />
      </div>

      <SectionHeader
        title="Object"
        description="Rules belong to one object. Pick an object to see its rules."
      />

      {/* A radio group rather than a tab bar: these are a single choice that
          changes the content below, and radios give keyboard users arrow-key
          movement and a real group label without re-implementing tab semantics. */}
      <div className="fo-duprules__objects" role="radiogroup" aria-label="Object">
        {RULE_OBJECTS.map((o) => {
          const count = rulesForObject(o.id).length;
          const active = o.id === objectId;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`fo-duprules__object${active ? " is-selected" : ""}`}
              onClick={() => setObjectId(o.id)}
            >
              <span className="fo-duprules__object-label">{o.label}</span>
              <span className="fo-duprules__object-count fo-tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <SectionHeader
        level={3}
        title={`${selected.singular} rules`}
        description={
          rules.length > 1
            ? "A record is a suspected duplicate if any of these rules matches. If more than one matches, the strongest action applies."
            : "A record is a suspected duplicate if this rule matches."
        }
        actions={
          <Button variant="protected" reason={NOT_YET_EDITABLE}>
            Add rule
          </Button>
        }
      />

      <div className="fo-duprules__list">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>
    </div>
  );
}

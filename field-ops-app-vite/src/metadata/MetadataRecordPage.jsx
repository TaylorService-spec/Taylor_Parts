import { componentRegistry } from "./registry.js";
import { buildCompositionPlan, applyVisibility } from "./pageRuntime.js";
import { REGION } from "./pageDefinition.js";
import FailureState from "../shared/ui/FailureState";

// Renders a PageDefinition. Thin by design: every decision about WHICH sections appear,
// where, in what order, and whether a viewer may see them was already made by
// pageRuntime.js, which is pure and exhaustively tested. This component maps a plan to
// EOS markup and does nothing else.
//
// That thinness is the point rather than a style preference. If placement or visibility
// logic lived here, "does an unauthorized section render?" would only be answerable by
// rendering things and looking — and the §6 boundary would be enforced by a component
// that also has to worry about CSS.
//
// §6 — DECISIONS COME IN, THEY ARE NOT MADE HERE. `capabilityDecisions` is the caller's
// already-resolved map. This component never calls a resolver, and passing it an empty
// map hides every gated section rather than revealing them. Rules and trusted commands
// remain the actual boundary; nothing rendered here can perform an action.
//
// §8 — components arrive from the REGISTRY by id. A definition can never supply a
// function, so no configuration path can introduce code.

/** Regions render in a fixed order. Layout is not a per-page decision. */
const RENDER_ORDER = ["HEADER", "HIGHLIGHTS", "MAIN", "SIDE", "FOOTER"];

const REGION_CLASS = {
  HEADER: "fo-record-header",
  HIGHLIGHTS: "fo-record-highlights",
  MAIN: "fo-record-main",
  SIDE: "fo-account-secondary",
  FOOTER: "fo-record-footer",
};

function Section({ section, record, listRenderer }) {
  const entry = section.componentId ? componentRegistry.resolve(section.componentId) : null;

  if (section.kind === "RELATED_LIST") {
    // Related lists are rendered by the list runtime, injected rather than imported, so
    // this component has no opinion about how a list works and the two runtimes stay
    // independently testable.
    return listRenderer ? listRenderer({ listId: section.listId, parentId: record?.id, section }) : null;
  }

  if (!entry) return null;
  const Component = entry.component;
  return <Component section={section} record={record} />;
}

export default function MetadataRecordPage({
  definition,
  record,
  capabilityDecisions = {},
  listResolver,
  listRenderer,
}) {
  const plan = applyVisibility(buildCompositionPlan(definition, { listResolver }), capabilityDecisions);

  // A page whose sections were ALL excluded or hidden is not an empty page — it is a
  // page the viewer cannot see, and saying "nothing here" would send them looking for
  // missing data instead of missing access. Same distinction the list presentation model
  // draws between EMPTY and DENIED.
  if (plan.sections.length === 0) {
    const hiddenByAccess = (plan.hidden ?? []).length > 0;
    return (
      <FailureState
        title={hiddenByAccess ? "Not available to you" : "Nothing to display"}
        message={
          hiddenByAccess
            ? "You do not have access to any part of this record. Contact an administrator if you believe this is an error."
            : "This record has no sections configured."
        }
      />
    );
  }

  return (
    <div className="fo-record-page" data-composition-mode={plan.compositionMode}>
      {RENDER_ORDER.filter((r) => REGION.includes(r)).map((region) => {
        const sections = plan.regions[region] ?? [];
        if (sections.length === 0) return null;
        return (
          <div key={region} className={REGION_CLASS[region] ?? "fo-record-main"}>
            {sections.map((section) => (
              <section key={section.id} className="fo-record-section" aria-label={section.label ?? section.kind}>
                {section.label && <h3 className="fo-record-section-title">{section.label}</h3>}
                <Section section={section} record={record} listRenderer={listRenderer} />
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

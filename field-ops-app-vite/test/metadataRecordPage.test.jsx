// MetadataRecordPage — component tests.
//
// The component is deliberately thin, so these assert the properties that survive the
// boundary between a pure plan and rendered DOM. The governance rules themselves are
// tested in pageRuntime; what is tested HERE is that rendering does not quietly undo them.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import MetadataRecordPage from "../src/metadata/MetadataRecordPage.jsx";
import { buildRowHref } from "../src/metadata/listPresentation.js";
import { makeSection, makePageDefinition } from "../src/metadata/pageDefinition.js";
import { componentRegistry, actionRegistry } from "../src/metadata/registry.js";
import { makeEntityDefinition, makeFieldDefinition, makeRelationshipDefinition } from "../src/metadata/entityDefinition.js";
import { makeListViewDefinition, makeColumn } from "../src/metadata/listViewDefinition.js";

// GAP 2's default RELATED_LIST binding drives the real three-layer list runtime
// (descriptor -> fetched page -> presentation model). fetchPage is the ONLY place that
// module touches Firestore (firestoreListSource.js's own header), so mocking it is the
// same boundary metadataFirestoreListSource.test.mjs mocks at, and it means these tests
// never need a firebase/firestore mock at all.
const fetchPageMock = vi.fn();
vi.mock("../src/metadata/firestoreListSource.js", () => ({
  fetchPage: (...args) => fetchPageMock(...args),
}));

// The CALLABLE-readVia counterpart of fetchPageMock, mocked at the same boundary
// (callableListSource.js's own fetchPage is the ONLY place that module touches a
// callable) so these tests exercise the routing decision, not either translator's
// internals — those are covered by metadataCallableListSource.test.jsx and
// metadataFirestoreListSource.test.jsx.
const fetchCallablePageMock = vi.fn();
vi.mock("../src/metadata/callableListSource.js", () => ({
  fetchPage: (...args) => fetchCallablePageMock(...args),
}));

const Lifecycle = ({ record }) => <p>lifecycle for {record?.id}</p>;
const Blockers = () => <p>blockers section</p>;
const Gated = () => <p>gated content</p>;

beforeEach(() => {
  componentRegistry.__resetForTest();
  actionRegistry.__resetForTest();
  componentRegistry.register({ id: "record.lifecycle", kind: "RECORD_SECTION", component: Lifecycle });
  componentRegistry.register({ id: "record.blockers", kind: "RECORD_SECTION", component: Blockers });
  componentRegistry.register({ id: "record.gated", kind: "RECORD_SECTION", component: Gated });
  fetchPageMock.mockReset();
  fetchCallablePageMock.mockReset();
});

const workOrderPage = (over = {}) =>
  makePageDefinition({
    id: "workOrder.record",
    entityId: "workOrder",
    label: "Work Order",
    compositionMode: "OPERATIONAL",
    sections: [
      makeSection({ id: "lc", kind: "LIFECYCLE", label: "Lifecycle", region: "HEADER", order: 0, componentId: "record.lifecycle" }),
      makeSection({ id: "bl", kind: "BLOCKERS", label: "Blockers", region: "MAIN", order: 0, componentId: "record.blockers" }),
    ],
    ...over,
  });

describe("buildRowHref", () => {
  it("substitutes the row's routing key for the template's dynamic segment", () => {
    expect(buildRowHref("/customers/:id", "acct-1")).toBe("/customers/acct-1");
  });

  it("substitutes whatever param name the template declares, not just :id", () => {
    // Templates in this program are not uniform — equipment.js uses :equipmentId,
    // salesOrder.js uses :salesOrderId. The template names its own resource.
    expect(buildRowHref("/equipment/:equipmentId", "eq-9")).toBe("/equipment/eq-9");
  });

  it("returns null for a missing template or key, never a malformed href", () => {
    expect(buildRowHref(null, "acct-1")).toBeNull();
    expect(buildRowHref("/customers/:id", null)).toBeNull();
  });
});

describe("MetadataRecordPage", () => {
  it("renders registered section components and passes the record through", () => {
    render(<MetadataRecordPage definition={workOrderPage()} record={{ id: "wo-1" }} />);
    expect(screen.getByText("lifecycle for wo-1")).toBeTruthy();
    expect(screen.getByText("blockers section")).toBeTruthy();
  });

  it("places sections in their declared regions, and renders no container for an empty one", () => {
    const { container } = render(<MetadataRecordPage definition={workOrderPage()} record={{ id: "wo-1" }} />);
    expect(container.querySelector(".fo-record-header")).toBeTruthy();
    expect(container.querySelector(".fo-record-main")).toBeTruthy();
    // CSS that reserves space for a region must not leave a visible gap where nothing exists.
    expect(container.querySelector(".fo-account-secondary")).toBeNull();
  });

  it("§6 — a section whose capability is not granted never reaches the DOM", () => {
    // Not hidden with CSS, not rendered-then-removed: never rendered. A component that
    // rendered gated content and hid it would still put it in the page source.
    const def = workOrderPage({
      sections: [
        makeSection({ id: "open", kind: "LIFECYCLE", region: "MAIN", order: 0, componentId: "record.lifecycle" }),
        makeSection({ id: "gated", kind: "BLOCKERS", region: "MAIN", order: 1, componentId: "record.gated", capabilityRequirement: "finance.read" }),
      ],
    });
    render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} capabilityDecisions={{}} />);
    expect(screen.getByText("lifecycle for wo-1")).toBeTruthy();
    expect(screen.queryByText("gated content")).toBeNull();
  });

  it("§6 — an explicit grant reveals the section", () => {
    const def = workOrderPage({
      sections: [
        makeSection({ id: "gated", kind: "BLOCKERS", region: "MAIN", order: 0, componentId: "record.gated", capabilityRequirement: "finance.read" }),
      ],
    });
    render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} capabilityDecisions={{ "finance.read": true }} />);
    expect(screen.getByText("gated content")).toBeTruthy();
  });

  it("§6 — a page hidden entirely by access says so, rather than 'nothing here'", () => {
    // The EMPTY vs DENIED distinction, at page level. "Nothing to display" would send
    // someone looking for missing data instead of missing access.
    const def = workOrderPage({
      sections: [
        makeSection({ id: "gated", kind: "BLOCKERS", region: "MAIN", order: 0, componentId: "record.gated", capabilityRequirement: "finance.read" }),
      ],
    });
    render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} capabilityDecisions={{}} />);
    expect(screen.getByText(/do not have access/i)).toBeTruthy();
    expect(screen.queryByText(/no sections configured/i)).toBeNull();
  });

  it("a page with no sections at all reports configuration, not access", () => {
    const def = makePageDefinition({ id: "p", entityId: "e", label: "P", sections: [] });
    render(<MetadataRecordPage definition={def} record={{ id: "x" }} />);
    expect(screen.getByText(/no sections configured/i)).toBeTruthy();
  });

  it("a section whose component is unregistered is skipped, leaving no titled shell", () => {
    // An empty section with a heading reads to a user as "this exists and is empty",
    // which is a different and false statement.
    const def = workOrderPage({
      sections: [
        makeSection({ id: "ghost", kind: "LIFECYCLE", label: "Ghost", region: "MAIN", order: 0, componentId: "record.missing" }),
        makeSection({ id: "bl", kind: "BLOCKERS", label: "Blockers", region: "MAIN", order: 1, componentId: "record.blockers" }),
      ],
    });
    render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} />);
    expect(screen.getByText("blockers section")).toBeTruthy();
    expect(screen.queryByText("Ghost")).toBeNull();
  });

  it("related lists are delegated to an injected renderer, never imported here", () => {
    // Keeps the two runtimes independently testable and stops this component acquiring
    // an opinion about how a list works.
    const listRenderer = vi.fn(({ listId, parentId }) => <p>{`list ${listId} for ${parentId}`}</p>);
    const def = workOrderPage({
      sections: [makeSection({ id: "parts", kind: "RELATED_LIST", label: "Parts", region: "MAIN", order: 0, listId: "wo.parts" })],
    });
    render(
      <MetadataRecordPage
        definition={def}
        record={{ id: "wo-1" }}
        listResolver={(id) => ({ id })}
        listRenderer={listRenderer}
      />
    );
    expect(screen.getByText("list wo.parts for wo-1")).toBeTruthy();
    expect(listRenderer).toHaveBeenCalledTimes(1);
  });

  it("exposes the composition mode, so an operational page is distinguishable in the DOM", () => {
    const { container } = render(<MetadataRecordPage definition={workOrderPage()} record={{ id: "wo-1" }} />);
    expect(container.querySelector('[data-composition-mode="OPERATIONAL"]')).toBeTruthy();
  });

  // ── GAP 1 — FIELD_GROUP renders its declared fields instead of an empty shell ──────

  describe("GAP 1 — the default FIELD_GROUP renderer", () => {
    const workOrderEntity = makeEntityDefinition({
      id: "workOrder",
      label: "Work Order",
      readVia: "CLIENT_DIRECT",
      collection: "workOrders",
      fields: [
        makeFieldDefinition({ id: "priority", entityId: "workOrder", label: "Priority", type: "ENUM", enumLabels: { HIGH: "High priority" } }),
        makeFieldDefinition({ id: "notes", entityId: "workOrder", label: "Notes", type: "STRING" }),
      ],
    });

    it("renders declared fields with FieldDefinition labels and resolved enum values", () => {
      const def = workOrderPage({
        sections: [
          makeSection({ id: "fg", kind: "FIELD_GROUP", label: "Details", region: "MAIN", order: 0, fieldIds: ["priority", "notes"] }),
        ],
      });
      render(
        <MetadataRecordPage
          definition={def}
          record={{ id: "wo-1", priority: "HIGH", notes: "" }}
          entityResolver={(id) => (id === "workOrder" ? workOrderEntity : null)}
        />
      );
      expect(screen.getByText("Priority")).toBeTruthy();
      // The raw stored value is "HIGH" — the enum's LABEL is what must reach the DOM,
      // the same rule cellValue() already enforces for list cells (§ "0 Active" #1093).
      expect(screen.getByText("High priority")).toBeTruthy();
      expect(screen.queryByText("HIGH")).toBeNull();
      // An empty string is absent data, shown honestly rather than as a blank cell.
      expect(screen.getByText("Notes")).toBeTruthy();
      expect(screen.getByText("—")).toBeTruthy();
    });

    it("without an entityResolver, says so rather than rendering an empty shell", () => {
      // The false statement this whole gap exists to avoid: a FIELD_GROUP with no
      // component and no way to resolve its own fields must not read as "nothing here".
      const def = workOrderPage({
        sections: [
          makeSection({ id: "fg", kind: "FIELD_GROUP", label: "Details", region: "MAIN", order: 0, fieldIds: ["priority"] }),
        ],
      });
      render(<MetadataRecordPage definition={def} record={{ id: "wo-1", priority: "HIGH" }} />);
      expect(screen.getByText(/field details are unavailable/i)).toBeTruthy();
    });

    it("a componentId still wins over the generic renderer", () => {
      const def = workOrderPage({
        sections: [
          makeSection({ id: "fg", kind: "FIELD_GROUP", label: "Details", region: "MAIN", order: 0, fieldIds: ["priority"], componentId: "record.gated" }),
        ],
      });
      render(
        <MetadataRecordPage
          definition={def}
          record={{ id: "wo-1", priority: "HIGH" }}
          entityResolver={(id) => (id === "workOrder" ? workOrderEntity : null)}
        />
      );
      expect(screen.getByText("gated content")).toBeTruthy();
      expect(screen.queryByText("Priority")).toBeNull();
    });

    // ── X-CAPABILITY-PARTS-FIELDGROUP-UNCONSUMED — the generic FIELD_GROUP renderer
    // honors withheld capabilityParts instead of rendering every declared field
    // unconditionally. ─────────────────────────────────────────────────────────────

    describe("X-CAPABILITY-PARTS-FIELDGROUP-UNCONSUMED — capabilityParts on FIELD_GROUP", () => {
      const record = { id: "wo-1", priority: "HIGH", notes: "Leaking valve" };

      const renderFieldGroup = (capabilityParts, capabilityDecisions) => {
        const def = workOrderPage({
          sections: [
            makeSection({
              id: "fg",
              kind: "FIELD_GROUP",
              label: "Details",
              region: "MAIN",
              order: 0,
              fieldIds: ["priority", "notes"],
              capabilityParts,
            }),
          ],
        });
        return render(
          <MetadataRecordPage
            definition={def}
            record={record}
            capabilityDecisions={capabilityDecisions}
            entityResolver={(id) => (id === "workOrder" ? workOrderEntity : null)}
          />
        );
      };

      it("renders unchanged with no capabilityParts declared — the additivity guarantee", () => {
        // Same fixture, same fields, capabilityParts entirely absent. This must be pixel
        // for pixel the pre-existing "renders declared fields" behavior: no withholding
        // note, both fields present.
        const def = workOrderPage({
          sections: [makeSection({ id: "fg", kind: "FIELD_GROUP", label: "Details", region: "MAIN", order: 0, fieldIds: ["priority", "notes"] })],
        });
        render(
          <MetadataRecordPage
            definition={def}
            record={record}
            entityResolver={(id) => (id === "workOrder" ? workOrderEntity : null)}
          />
        );
        expect(screen.getByText("High priority")).toBeTruthy();
        expect(screen.getByText("Leaking valve")).toBeTruthy();
        expect(screen.queryByText(/not available to you/i)).toBeNull();
      });

      it("a fully-granted composed section renders every field with no withholding note", () => {
        renderFieldGroup(
          [
            { id: "core", capabilityRequirement: "workOrder.read", fieldIds: ["priority"] },
            { id: "notes", capabilityRequirement: "workOrder.notes.read", fieldIds: ["notes"] },
          ],
          { "workOrder.read": true, "workOrder.notes.read": true }
        );
        expect(screen.getByText("High priority")).toBeTruthy();
        expect(screen.getByText("Leaking valve")).toBeTruthy();
        expect(screen.queryByText(/not available to you/i)).toBeNull();
      });

      it("a partially-withheld section renders only the entitled field and surfaces the withholding", () => {
        renderFieldGroup(
          [
            { id: "core", capabilityRequirement: null, fieldIds: ["priority"] },
            { id: "notes", capabilityRequirement: "workOrder.notes.read", fieldIds: ["notes"] },
          ],
          {} // workOrder.notes.read not granted
        );
        expect(screen.getByText("High priority")).toBeTruthy();
        expect(screen.queryByText("Leaking valve")).toBeNull();
        expect(screen.queryByText("Notes")).toBeNull();
        expect(screen.getByText(/not available to you/i)).toBeTruthy();
      });

      it("empty-vs-withheld: a visible field with no data still shows '—', not the withholding note", () => {
        // Every part visible, one field's value is legitimately absent. This must read as
        // EMPTY (the existing "—" convention), never as WITHHELD.
        const def = workOrderPage({
          sections: [
            makeSection({
              id: "fg",
              kind: "FIELD_GROUP",
              label: "Details",
              region: "MAIN",
              order: 0,
              fieldIds: ["priority", "notes"],
              capabilityParts: [{ id: "core", capabilityRequirement: null, fieldIds: ["priority", "notes"] }],
            }),
          ],
        });
        render(
          <MetadataRecordPage
            definition={def}
            record={{ id: "wo-2", priority: "HIGH", notes: "" }}
            entityResolver={(id) => (id === "workOrder" ? workOrderEntity : null)}
          />
        );
        expect(screen.getByText("—")).toBeTruthy();
        expect(screen.queryByText(/not available to you/i)).toBeNull();
      });

      it("fails closed on malformed capabilityParts metadata — withholds every field, never renders any", () => {
        // A duplicate field claim is exactly the shape validatePageDefinition rejects at
        // definition time; this simulates it reaching the runtime anyway (a hand-built
        // fixture, or a future caller that skips validation) to prove the render path
        // has its own defence, not just the definition-time one.
        renderFieldGroup(
          [
            { id: "core", capabilityRequirement: null, fieldIds: ["priority"] },
            { id: "dup", capabilityRequirement: null, fieldIds: ["priority"] },
          ],
          {}
        );
        expect(screen.queryByText("High priority")).toBeNull();
        expect(screen.queryByText("Leaking valve")).toBeNull();
        expect(screen.getByText(/not available to you/i)).toBeTruthy();
      });

      it("a field id claimed by no capabilityParts entry is withheld, not rendered ungated", () => {
        // "notes" is in the section's own fieldIds but no part claims it — ownership
        // cannot be determined, so this fails closed the same as an explicitly withheld
        // field (the deliberate choice this task requires be made and justified: see the
        // FieldGroup doc comment in MetadataRecordPage.jsx).
        renderFieldGroup(
          [{ id: "core", capabilityRequirement: null, fieldIds: ["priority"] }],
          {}
        );
        expect(screen.getByText("High priority")).toBeTruthy();
        expect(screen.queryByText("Leaking valve")).toBeNull();
        expect(screen.queryByText("Notes")).toBeNull();
        expect(screen.getByText(/not available to you/i)).toBeTruthy();
      });
    });
  });

  // ── GAP 2 — RELATED_LIST renders through a default binding to the list runtime ────

  describe("GAP 2 — the default RELATED_LIST binding", () => {
    const accountEntity = makeEntityDefinition({
      id: "account",
      label: "Account",
      readVia: "CLIENT_DIRECT",
      collection: "accounts",
      relationships: [
        makeRelationshipDefinition({
          id: "account.opportunities",
          label: "Opportunities",
          fromEntityId: "account",
          toEntityId: "opportunity",
          viaField: "accountId",
          cardinality: "ONE_TO_MANY",
        }),
      ],
    });
    const opportunityEntity = makeEntityDefinition({
      id: "opportunity",
      label: "Opportunity",
      readVia: "CLIENT_DIRECT",
      collection: "opportunities",
      fields: [makeFieldDefinition({ id: "name", entityId: "opportunity", label: "Name", type: "STRING" })],
    });
    const opportunitiesList = makeListViewDefinition({
      id: "account.opportunities.related",
      entityId: "opportunity",
      label: "Opportunities",
      surface: "RELATED",
      parentRelationshipId: "account.opportunities",
      columns: [makeColumn({ fieldId: "name" })],
      tiebreaker: "__name__",
    });

    const accountPage = () =>
      makePageDefinition({
        id: "account.record",
        entityId: "account",
        label: "Account",
        sections: [
          makeSection({ id: "opps", kind: "RELATED_LIST", label: "Opportunities", region: "MAIN", order: 0, listId: "account.opportunities.related" }),
        ],
      });

    it("renders rows through the default binding, scoped to the parent record", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      render(
        <MemoryRouter>
          <MetadataRecordPage
            definition={accountPage()}
            record={{ id: "acct-1" }}
            listResolver={(id) => (id === "account.opportunities.related" ? opportunitiesList : null)}
            entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          />
        </MemoryRouter>
      );
      expect(await screen.findByText("Big Deal")).toBeTruthy();
      // Scoped to the parent — the exact defect findParentRelationship/buildQueryDescriptor
      // exist to prevent (an unscoped RELATED section reading every record of the target
      // entity, the shape of the account/opportunity defect this file's own history notes).
      const [descriptor] = fetchPageMock.mock.calls[0];
      expect(descriptor.filters).toContainEqual(expect.objectContaining({ fieldId: "accountId", operator: "EQUALS", value: "acct-1" }));
    });

    it("an injected listRenderer still wins over the default binding", () => {
      const listRenderer = vi.fn(({ listId, parentId }) => <p>{`custom ${listId} for ${parentId}`}</p>);
      render(
        <MetadataRecordPage
          definition={accountPage()}
          record={{ id: "acct-1" }}
          listResolver={(id) => (id === "account.opportunities.related" ? opportunitiesList : null)}
          entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          listRenderer={listRenderer}
        />
      );
      expect(screen.getByText("custom account.opportunities.related for acct-1")).toBeTruthy();
      expect(fetchPageMock).not.toHaveBeenCalled();
    });
  });

  // ── GAP 2b — the default binding ROUTES by the child entity's declared readVia ─────
  //
  // Two entities in this program (opportunity, salesOrder) are deny-all in Firestore
  // Rules and readable only through a trusted callable — declared as `readVia: "CALLABLE"`
  // with a `readCallable` name. Defaulting every RELATED_LIST to the Firestore source
  // regardless of that declaration is the defect this closes: it would issue a live
  // `getDocs` against a deny-all collection and report every viewer denied, permanently.

  describe("GAP 2b — routing by readVia", () => {
    const accountEntity = makeEntityDefinition({
      id: "account",
      label: "Account",
      readVia: "CLIENT_DIRECT",
      collection: "accounts",
      relationships: [
        makeRelationshipDefinition({
          id: "account.opportunities",
          label: "Opportunities",
          fromEntityId: "account",
          toEntityId: "opportunity",
          viaField: "accountId",
          cardinality: "ONE_TO_MANY",
        }),
      ],
    });
    const nameField = (entityId) => makeFieldDefinition({ id: "name", entityId, label: "Name", type: "STRING" });
    const opportunitiesList = makeListViewDefinition({
      id: "account.opportunities.related",
      entityId: "opportunity",
      label: "Opportunities",
      surface: "RELATED",
      parentRelationshipId: "account.opportunities",
      columns: [makeColumn({ fieldId: "name" })],
      tiebreaker: "__name__",
    });
    const accountPage = () =>
      makePageDefinition({
        id: "account.record",
        entityId: "account",
        label: "Account",
        sections: [
          makeSection({ id: "opps", kind: "RELATED_LIST", label: "Opportunities", region: "MAIN", order: 0, listId: "account.opportunities.related" }),
        ],
      });
    const renderWithChildEntity = (opportunityEntity) =>
      render(
        <MemoryRouter>
          <MetadataRecordPage
            definition={accountPage()}
            record={{ id: "acct-1" }}
            listResolver={(id) => (id === "account.opportunities.related" ? opportunitiesList : null)}
            entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          />
        </MemoryRouter>
      );

    it("CLIENT_DIRECT invokes the Firestore source and never the callable source", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Direct Deal" }], hasMore: false, nextCursorDoc: null });
      const opportunityEntity = makeEntityDefinition({
        id: "opportunity",
        label: "Opportunity",
        readVia: "CLIENT_DIRECT",
        collection: "opportunities",
        fields: [nameField("opportunity")],
      });
      renderWithChildEntity(opportunityEntity);
      expect(await screen.findByText("Direct Deal")).toBeTruthy();
      expect(fetchPageMock).toHaveBeenCalledTimes(1);
      expect(fetchCallablePageMock).not.toHaveBeenCalled();
    });

    it("CALLABLE with a declared readCallable invokes the callable source and never the Firestore source", async () => {
      fetchCallablePageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Callable Deal" }], hasMore: false, nextCursorDoc: null });
      const opportunityEntity = makeEntityDefinition({
        id: "opportunity",
        label: "Opportunity",
        readVia: "CALLABLE",
        readCallable: "listOpportunitiesForAccount",
        fields: [nameField("opportunity")],
      });
      renderWithChildEntity(opportunityEntity);
      expect(await screen.findByText("Callable Deal")).toBeTruthy();
      expect(fetchCallablePageMock).toHaveBeenCalledTimes(1);
      expect(fetchPageMock).not.toHaveBeenCalled();
      // The SAME descriptor the Firestore source would have received — the runtime's
      // decisions (parent scope, sort, bound) do not change with the source.
      const [descriptor] = fetchCallablePageMock.mock.calls[0];
      expect(descriptor.filters).toContainEqual(expect.objectContaining({ fieldId: "accountId", operator: "EQUALS", value: "acct-1" }));
    });

    it("CALLABLE with no readCallable declared renders an explicit unavailable state, attempting neither source", async () => {
      const opportunityEntity = makeEntityDefinition({
        id: "opportunity",
        label: "Opportunity",
        readVia: "CALLABLE",
        // readCallable intentionally omitted — a misconfigured entity.
        fields: [nameField("opportunity")],
      });
      renderWithChildEntity(opportunityEntity);
      expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
      expect(fetchPageMock).not.toHaveBeenCalled();
      expect(fetchCallablePageMock).not.toHaveBeenCalled();
    });

    it("UNKNOWN readVia renders an explicit unavailable state, never falling through to a direct read", async () => {
      const opportunityEntity = makeEntityDefinition({
        id: "opportunity",
        label: "Opportunity",
        // readVia omitted entirely -> defaults to "UNKNOWN" (entityDefinition.js).
        fields: [nameField("opportunity")],
      });
      renderWithChildEntity(opportunityEntity);
      expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
      expect(fetchPageMock).not.toHaveBeenCalled();
      expect(fetchCallablePageMock).not.toHaveBeenCalled();
    });

    it("a permission-denied rejection from the callable source surfaces as DENIED, not empty", async () => {
      const denied = new Error("nope");
      denied.code = "permission-denied";
      fetchCallablePageMock.mockRejectedValue(denied);
      const opportunityEntity = makeEntityDefinition({
        id: "opportunity",
        label: "Opportunity",
        readVia: "CALLABLE",
        readCallable: "listOpportunitiesForAccount",
        fields: [nameField("opportunity")],
      });
      renderWithChildEntity(opportunityEntity);
      expect(await screen.findByText(/do not have access to opportunities/i)).toBeTruthy();
      expect(screen.queryByText(/no opportunities yet/i)).toBeNull();
    });
  });

  // ── DEFECT 2 — rowNavigationTo had zero consumers ──────────────────────────────────
  //
  // makeListViewDefinition accepts rowNavigationTo (a route template like
  // "/customers/:id") and, before this, nothing in the repo read it: DefaultRelatedList
  // passed MetadataListGrid no onRowClick, so every row rendered through the metadata
  // path was inert. A LocationProbe alongside the page is the only way to observe a real
  // react-router navigation without mocking useNavigate — it renders the CURRENT
  // location's pathname so a click's effect is visible in the DOM.

  describe("DEFECT 2 — rowNavigationTo is wired to row clicks", () => {
    const accountEntity = makeEntityDefinition({
      id: "account",
      label: "Account",
      readVia: "CLIENT_DIRECT",
      collection: "accounts",
      relationships: [
        makeRelationshipDefinition({
          id: "account.opportunities",
          label: "Opportunities",
          fromEntityId: "account",
          toEntityId: "opportunity",
          viaField: "accountId",
          cardinality: "ONE_TO_MANY",
        }),
      ],
    });
    const opportunityEntity = makeEntityDefinition({
      id: "opportunity",
      label: "Opportunity",
      readVia: "CLIENT_DIRECT",
      collection: "opportunities",
      fields: [makeFieldDefinition({ id: "name", entityId: "opportunity", label: "Name", type: "STRING" })],
    });
    const accountPage = () =>
      makePageDefinition({
        id: "account.record",
        entityId: "account",
        label: "Account",
        sections: [
          makeSection({ id: "opps", kind: "RELATED_LIST", label: "Opportunities", region: "MAIN", order: 0, listId: "account.opportunities.related" }),
        ],
      });

    // Renders the current location's pathname into the DOM, so a click's navigation
    // effect is observable without mocking react-router's useNavigate.
    function LocationProbe() {
      const location = useLocation();
      return <p data-testid="location">{location.pathname}</p>;
    }

    const renderWithList = (listDef) =>
      render(
        <MemoryRouter initialEntries={["/customers/acct-1"]}>
          <LocationProbe />
          <MetadataRecordPage
            definition={accountPage()}
            record={{ id: "acct-1" }}
            listResolver={(id) => (id === "account.opportunities.related" ? listDef : null)}
            entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          />
        </MemoryRouter>
      );

    it("a row click navigates to the template with the routing key substituted", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowNavigationTo: "/sales/opportunities/:id",
      });
      renderWithList(listDef);
      const row = (await screen.findByText("Big Deal")).closest("tr");
      fireEvent.click(row);
      expect((await screen.findByTestId("location")).textContent).toBe("/sales/opportunities/opp-1");
    });

    it("a list with no rowNavigationTo renders non-focusable rows and no handler", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        // rowNavigationTo intentionally omitted.
      });
      renderWithList(listDef);
      const row = (await screen.findByText("Big Deal")).closest("tr");
      expect(row.getAttribute("tabindex")).toBeNull();
      fireEvent.click(row);
      // No navigation occurred — the location stays where it started.
      expect((await screen.findByTestId("location")).textContent).toBe("/customers/acct-1");
    });

    it("the document id still never appears as cell content when a route is wired", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowNavigationTo: "/sales/opportunities/:id",
      });
      renderWithList(listDef);
      await screen.findByText("Big Deal");
      expect(screen.queryByText("opp-1")).toBeNull();
    });
  });

  // ── X-RELATED-LIST-ACTIONS — DefaultRelatedList resolves declared rowActions ───────
  //
  // listViewDefinition.js already accepts `rowActions` (registered action ids); nothing
  // in the render path consumed it before this. DefaultRelatedList now resolves those
  // ids through actionRegistry and the caller's `capabilityDecisions`, the same
  // fail-closed rule MetadataRecordPage already applies to section visibility
  // (applyVisibility/pageRuntime), applied here to a row instead of a whole section.

  describe("X-RELATED-LIST-ACTIONS — DefaultRelatedList row actions", () => {
    const accountEntity = makeEntityDefinition({
      id: "account",
      label: "Account",
      readVia: "CLIENT_DIRECT",
      collection: "accounts",
      relationships: [
        makeRelationshipDefinition({
          id: "account.opportunities",
          label: "Opportunities",
          fromEntityId: "account",
          toEntityId: "opportunity",
          viaField: "accountId",
          cardinality: "ONE_TO_MANY",
        }),
      ],
    });
    const opportunityEntity = makeEntityDefinition({
      id: "opportunity",
      label: "Opportunity",
      readVia: "CLIENT_DIRECT",
      collection: "opportunities",
      fields: [makeFieldDefinition({ id: "name", entityId: "opportunity", label: "Name", type: "STRING" })],
    });
    const accountPage = () =>
      makePageDefinition({
        id: "account.record",
        entityId: "account",
        label: "Account",
        sections: [
          makeSection({ id: "opps", kind: "RELATED_LIST", label: "Opportunities", region: "MAIN", order: 0, listId: "account.opportunities.related" }),
        ],
      });

    const renderWithList = (listDef, capabilityDecisions) =>
      render(
        <MemoryRouter>
          <MetadataRecordPage
            definition={accountPage()}
            record={{ id: "acct-1" }}
            capabilityDecisions={capabilityDecisions}
            listResolver={(id) => (id === "account.opportunities.related" ? listDef : null)}
            entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          />
        </MemoryRouter>
      );

    it("a list with no rowActions declared renders no actions column (unchanged)", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        // rowActions intentionally omitted.
      });
      renderWithList(listDef);
      await screen.findByText("Big Deal");
      expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    });

    it("an ungated action resolves and dispatches to its registered handler with the row key", async () => {
      const handler = vi.fn();
      actionRegistry.register({ id: "opportunity.edit", label: "Edit", kind: "NAVIGATION", handler });
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowActions: ["opportunity.edit"],
      });
      renderWithList(listDef, {});
      const editButton = await screen.findByRole("button", { name: /edit/i });
      fireEvent.click(editButton);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBe("opp-1");
    });

    it("a GOVERNED_COMMAND row action with no matching decision fails closed — denied, not merely hidden", async () => {
      const handler = vi.fn();
      actionRegistry.register({
        id: "opportunity.close",
        label: "Close",
        kind: "GOVERNED_COMMAND",
        command: "closeOpportunity",
        capabilityRequirement: "opportunity.write",
        handler,
      });
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowActions: ["opportunity.close"],
      });
      // Neither an absent decision, nor an explicit false, is a grant.
      renderWithList(listDef, {});
      const closeButton = await screen.findByRole("button", { name: /close/i });
      expect(closeButton.disabled).toBe(true);
      fireEvent.click(closeButton);
      expect(handler).not.toHaveBeenCalled();
    });

    it("an explicit true decision authorizes the same row action", async () => {
      const handler = vi.fn();
      actionRegistry.register({
        id: "opportunity.close",
        label: "Close",
        kind: "GOVERNED_COMMAND",
        command: "closeOpportunity",
        capabilityRequirement: "opportunity.write",
        handler,
      });
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowActions: ["opportunity.close"],
      });
      renderWithList(listDef, { "opportunity.write": true });
      const closeButton = await screen.findByRole("button", { name: /close/i });
      expect(closeButton.disabled).toBe(false);
      fireEvent.click(closeButton);
      expect(handler).toHaveBeenCalledWith("opp-1", expect.objectContaining({ record: { id: "acct-1" } }));
    });

    it("an unregistered action id is dropped as a configuration gap, not rendered as a denied action", async () => {
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowActions: ["opportunity.nonexistent"],
      });
      renderWithList(listDef, {});
      await screen.findByText("Big Deal");
      expect(screen.queryByRole("button")).toBeNull();
    });

    // Local to this block — the DEFECT 2 describe above scopes its own LocationProbe to
    // its own callback, so this is a second, identical probe rather than a shared one.
    function LocationProbe() {
      const location = useLocation();
      return <p data-testid="location">{location.pathname}</p>;
    }

    it("activating a row action does not also navigate the row when rowNavigationTo is also declared", async () => {
      const handler = vi.fn();
      actionRegistry.register({ id: "opportunity.edit", label: "Edit", kind: "NAVIGATION", handler });
      fetchPageMock.mockResolvedValue({ rows: [{ id: "opp-1", name: "Big Deal" }], hasMore: false, nextCursorDoc: null });
      const listDef = makeListViewDefinition({
        id: "account.opportunities.related",
        entityId: "opportunity",
        label: "Opportunities",
        surface: "RELATED",
        parentRelationshipId: "account.opportunities",
        columns: [makeColumn({ fieldId: "name" })],
        tiebreaker: "__name__",
        rowActions: ["opportunity.edit"],
        rowNavigationTo: "/sales/opportunities/:id",
      });
      render(
        <MemoryRouter initialEntries={["/customers/acct-1"]}>
          <LocationProbe />
          <MetadataRecordPage
            definition={accountPage()}
            record={{ id: "acct-1" }}
            capabilityDecisions={{}}
            listResolver={(id) => (id === "account.opportunities.related" ? listDef : null)}
            entityResolver={(id) => ({ account: accountEntity, opportunity: opportunityEntity }[id] ?? null)}
          />
        </MemoryRouter>
      );
      const editButton = await screen.findByRole("button", { name: /edit/i });
      fireEvent.click(editButton);
      expect(handler).toHaveBeenCalledTimes(1);
      // The row is ALSO navigable (rowNavigationTo declared) — activating the action
      // must not also fire that navigation.
      expect((await screen.findByTestId("location")).textContent).toBe("/customers/acct-1");
    });
  });

  // ── GAP 3 — REGION-level nothing vs PAGE-level denial ──────────────────────────────

  describe("GAP 3 — embedded scope", () => {
    it("a region whose only section is capability-hidden renders nothing, and the page does not become a denial", () => {
      // A full, non-embedded page: HEADER stays ungated and visible, SIDE's only section
      // is denied. Already correct today because applyVisibility rebuilds regions from
      // VISIBLE sections (pageRuntime.js) — locked in explicitly here.
      const def = workOrderPage({
        sections: [
          makeSection({ id: "lc", kind: "LIFECYCLE", region: "HEADER", order: 0, componentId: "record.lifecycle" }),
          makeSection({ id: "gated", kind: "BLOCKERS", region: "SIDE", order: 0, componentId: "record.gated", capabilityRequirement: "finance.read" }),
        ],
      });
      const { container } = render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} capabilityDecisions={{}} />);
      expect(screen.getByText("lifecycle for wo-1")).toBeTruthy();
      expect(container.querySelector(".fo-account-secondary")).toBeNull();
      expect(screen.queryByText(/do not have access/i)).toBeNull();
    });

    it("embedded: a region whose only section is hidden renders NOTHING, not the page-level denial", () => {
      // The real case this closes: accountPageComponents.js's accountRecordPageSideSubset
      // names only the (finance.read-gated) Account Attention section. Rendered standalone
      // (the default, embedded=false) that is indistinguishable from a whole page nobody
      // may see, so it correctly denies. Rendered embedded — because a caller is stitching
      // it into a larger, already-rendering page — denial would replace that surrounding
      // content's own graceful degrade, so it renders nothing instead.
      const def = makePageDefinition({
        id: "account.side",
        entityId: "account",
        label: "Account side",
        sections: [
          makeSection({ id: "gated", kind: "ATTENTION", region: "SIDE", order: 0, componentId: "record.gated", capabilityRequirement: "finance.read" }),
        ],
      });
      const { container } = render(
        <MetadataRecordPage definition={def} record={{ id: "acct-1" }} capabilityDecisions={{}} embedded />
      );
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText(/do not have access/i)).toBeNull();
      expect(screen.queryByText(/not available to you/i)).toBeNull();
    });

    it("embedded: a definition with no sections configured also renders nothing, not a page-level message", () => {
      const def = makePageDefinition({ id: "account.side", entityId: "account", label: "Account side", sections: [] });
      const { container } = render(<MetadataRecordPage definition={def} record={{ id: "acct-1" }} embedded />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText(/no sections configured/i)).toBeNull();
    });

    it("without embedded, a page hidden entirely by access still denies (unchanged default)", () => {
      const def = workOrderPage({
        sections: [
          makeSection({ id: "gated", kind: "BLOCKERS", region: "MAIN", order: 0, componentId: "record.gated", capabilityRequirement: "finance.read" }),
        ],
      });
      render(<MetadataRecordPage definition={def} record={{ id: "wo-1" }} capabilityDecisions={{}} />);
      expect(screen.getByText(/do not have access/i)).toBeTruthy();
    });

    it("without embedded, a page with no sections configured still reports configuration (unchanged default)", () => {
      const def = makePageDefinition({ id: "p", entityId: "e", label: "P", sections: [] });
      render(<MetadataRecordPage definition={def} record={{ id: "x" }} />);
      expect(screen.getByText(/no sections configured/i)).toBeTruthy();
    });
  });
});

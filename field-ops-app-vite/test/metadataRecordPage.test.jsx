// MetadataRecordPage — component tests.
//
// The component is deliberately thin, so these assert the properties that survive the
// boundary between a pure plan and rendered DOM. The governance rules themselves are
// tested in pageRuntime; what is tested HERE is that rendering does not quietly undo them.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MetadataRecordPage from "../src/metadata/MetadataRecordPage.jsx";
import { makeSection, makePageDefinition } from "../src/metadata/pageDefinition.js";
import { componentRegistry } from "../src/metadata/registry.js";

const Lifecycle = ({ record }) => <p>lifecycle for {record?.id}</p>;
const Blockers = () => <p>blockers section</p>;
const Gated = () => <p>gated content</p>;

beforeEach(() => {
  componentRegistry.__resetForTest();
  componentRegistry.register({ id: "record.lifecycle", kind: "RECORD_SECTION", component: Lifecycle });
  componentRegistry.register({ id: "record.blockers", kind: "RECORD_SECTION", component: Blockers });
  componentRegistry.register({ id: "record.gated", kind: "RECORD_SECTION", component: Gated });
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
});

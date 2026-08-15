// OD-3 / Wave 6 -- RENDER gate for NotificationPanel canonical name resolution (vitest +
// jsdom). NotificationPanel is presentational; AppHeader supplies a governed `resolveName`
// AND (since the Wave 6 bell migration) the `sections` prop built via
// domain/partsAttentionProjection.js's partsAttentionItems() + groupPartsAttentionItemsBySection().
// This file builds `sections` through the REAL projection (not a hand-rolled shape), so it
// also proves the projection -> panel wiring, not just the panel's own rendering. Proves the
// notification item name resolves via resolveName; fail-closed / default renders the raw
// partId (never a static name); and the sections, counts, urgency badges, and request
// identity link (partId + requestId) are preserved.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationPanel from "../src/shared/ui/NotificationPanel.jsx";
import { partsAttentionItems, groupPartsAttentionItemsBySection } from "../src/domain/partsAttentionProjection.js";

afterEach(() => cleanup());

const sectionsFor = (requests) => groupPartsAttentionItemsBySection(partsAttentionItems(requests));
const renderPanel = (props) => render(<MemoryRouter><NotificationPanel {...props} /></MemoryRouter>);
const openDropdown = () => fireEvent.click(screen.getByRole("button", { name: /Notifications/i }));
const canonical = (id) => (id === "TST-9001" ? "CANONICAL-NAME-A" : id);

describe("NotificationPanel (OD-3/Wave 6) -- resolveName name resolution + attention-projection wiring", () => {
  it("resolves the canonical name; preserves sections, count, urgency badge, and the requestId link", () => {
    renderPanel({
      sections: sectionsFor([
        { id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" },
        { id: "r2", partId: "TST-9002", status: "PENDING_REVIEW" },
      ]),
      resolveName: canonical,
    });
    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("(2)"); // count preserved
    openDropdown();
    expect(screen.getByText("Pending Review")).toBeTruthy();                 // section preserved
    expect(screen.getByText("CANONICAL-NAME-A")).toBeTruthy();               // canonical name
    expect(screen.getByText("Request urgency: HIGH")).toBeTruthy();          // urgency badge (named scale, #696)
    expect(screen.getByText("Needs planning")).toBeTruthy();                 // null-urgency badge
    // request identity link preserved: partId + requestId query param
    const link = screen.getByText("CANONICAL-NAME-A").closest("a");
    expect(link.getAttribute("href")).toContain("/inventory/TST-9001");
    expect(link.getAttribute("href")).toContain("requestId=r1");
  });

  it("fail-closed resolveName renders the raw partId (never a static name)", () => {
    renderPanel({ sections: sectionsFor([{ id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" }]), resolveName: (id) => id });
    openDropdown();
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
  });

  it("default (no resolveName prop) fails closed to the raw partId", () => {
    renderPanel({ sections: sectionsFor([{ id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" }]) });
    openDropdown();
    expect(screen.getByText("TST-9001")).toBeTruthy();
  });

  it("renders all four sections with resolved names, sourced from the ONE shared projection", () => {
    renderPanel({
      sections: sectionsFor([
        { id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" },
        { id: "r2", partId: "TST-9001", status: "READY_FOR_PARTS_MANAGER", urgency: "LOW" },
        { id: "r3", partId: "TST-9001", status: "ASSIGNED_TO_PARTS_ASSOCIATE", urgency: "MEDIUM", assignedToUserId: "u1" },
        { id: "r4", partId: "TST-9001", status: "PURCHASING_IN_PROGRESS", urgency: "HIGH" },
      ]),
      resolveName: canonical,
    });
    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("(4)");
    openDropdown();
    expect(screen.getByText("Pending Review")).toBeTruthy();
    expect(screen.getByText("Ready for Parts Manager")).toBeTruthy();
    expect(screen.getByText("Assigned to You")).toBeTruthy();
    expect(screen.getByText("Purchasing Started")).toBeTruthy();
    expect(screen.getAllByText("CANONICAL-NAME-A").length).toBe(4);
  });

  it("a terminal-status request is honestly excluded (matches today's disappearance, never fabricated)", () => {
    renderPanel({ sections: sectionsFor([{ id: "r1", partId: "TST-9001", status: "RECEIVED" }]) });
    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toBe("Notifications");
    openDropdown();
    expect(screen.getByText("No pending reorder requests.")).toBeTruthy();
  });
});

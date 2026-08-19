// MetadataListGrid — component tests.
//
// The model decides state, columns, cell values and copy; these assert the rendering
// does not undo those decisions. The one that matters most is the four empties: a
// component that routed EMPTY, FILTERED, DENIED and UNAVAILABLE through a single shared
// box would discard the entire reason the model separates them, and every test in
// listPresentation would still pass.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MetadataListGrid from "../src/metadata/MetadataListGrid.jsx";

const presentation = (over = {}) => ({
  listId: "account.index",
  surface: "INDEX",
  state: "READY",
  columns: [
    { fieldId: "name", label: "Account" },
    { fieldId: "status", label: "Status" },
  ],
  rows: [
    { key: "acct-1", cells: [{ fieldId: "name", value: "Northside Foods" }, { fieldId: "status", value: "Active" }] },
    { key: "acct-2", cells: [{ fieldId: "name", value: "Harbor Grill" }, { fieldId: "status", value: "Inactive" }] },
  ],
  hasMore: false,
  viewAllListId: null,
  truncated: false,
  emptyMessage: null,
  ...over,
});

describe("MetadataListGrid", () => {
  it("renders declared columns as headers and model cell values as cells", () => {
    render(<MetadataListGrid presentation={presentation()} />);
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeTruthy();
    expect(screen.getByText("Northside Foods")).toBeTruthy();
    // "Active", not "ACTIVE" — the model resolved the enum, and the grid must not
    // reintroduce the machine value it removed.
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("uses the document id to route the row and never as a cell", () => {
    const onRowClick = vi.fn();
    render(<MetadataListGrid presentation={presentation()} onRowClick={onRowClick} />);
    expect(screen.queryByText("acct-1")).toBeNull();
    expect(screen.queryByText("acct-2")).toBeNull();
  });

  it("a row activates by click and by keyboard, returning the routing key", () => {
    const onRowClick = vi.fn();
    const { container } = render(<MetadataListGrid presentation={presentation()} onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText("Northside Foods"));
    expect(onRowClick).toHaveBeenCalledWith("acct-1");

    // A row that only responds to a mouse is unreachable for anyone navigating by
    // keyboard, which is the population most dependent on a list being navigable.
    onRowClick.mockClear();
    const [firstRow] = container.querySelectorAll("tbody tr");
    fireEvent.keyDown(firstRow, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith("acct-1");

    onRowClick.mockClear();
    fireEvent.keyDown(firstRow, { key: " " });
    expect(onRowClick).toHaveBeenCalledWith("acct-1");
  });

  it("rows are not focusable when there is nowhere to go", () => {
    const { container } = render(<MetadataListGrid presentation={presentation()} />);
    expect(container.querySelector("tbody tr[tabindex]")).toBeNull();
  });

  describe("the four empties stay four", () => {
    const message = "the model's sentence";

    it("EMPTY reports legitimate emptiness, without alert semantics", () => {
      const { container } = render(
        <MetadataListGrid presentation={presentation({ state: "EMPTY", rows: [], emptyMessage: message })} />
      );
      expect(screen.getByText(message)).toBeTruthy();
      expect(container.querySelector('[data-empty-variant="database"]')).toBeTruthy();
      // An empty result is not an error, and announcing it as one trains people to
      // ignore the announcements that are.
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it("FILTERED is a different variant from EMPTY, not the same box with other words", () => {
      const { container } = render(
        <MetadataListGrid presentation={presentation({ state: "FILTERED", rows: [], emptyMessage: message })} />
      );
      expect(container.querySelector('[data-empty-variant="filtered"]')).toBeTruthy();
    });

    it("DENIED is announced as a failure, not rendered as emptiness", () => {
      const { container } = render(
        <MetadataListGrid presentation={presentation({ state: "DENIED", rows: [], emptyMessage: message })} />
      );
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      expect(container.querySelector(".fo-empty-state")).toBeNull();
    });

    it("DENIED offers no retry, because retrying a denied read is still denied", () => {
      render(
        <MetadataListGrid
          presentation={presentation({ state: "DENIED", rows: [], emptyMessage: message })}
          onRetry={() => {}}
        />
      );
      expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    });

    it("UNAVAILABLE offers retry, because retrying a failed read can work", () => {
      const onRetry = vi.fn();
      render(
        <MetadataListGrid
          presentation={presentation({ state: "UNAVAILABLE", rows: [], emptyMessage: message })}
          onRetry={onRetry}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("every non-READY state exposes itself, so a state is never silently blank", () => {
      for (const state of ["LOADING", "EMPTY", "FILTERED", "DENIED", "UNAVAILABLE"]) {
        const { container, unmount } = render(
          <MetadataListGrid presentation={presentation({ state, rows: [], emptyMessage: message })} />
        );
        expect(container.querySelector(`[data-list-state="${state}"]`)).toBeTruthy();
        expect(container.querySelector("table")).toBeNull();
        unmount();
      }
    });
  });

  it("an INDEX with more pages offers load more", () => {
    const onLoadMore = vi.fn();
    render(<MetadataListGrid presentation={presentation({ hasMore: true })} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("a truncated RELATED section hands off instead of paging", () => {
    // A related section that paged would become a second unbounded list inside a record.
    render(
      <MetadataListGrid
        presentation={presentation({ surface: "RELATED", hasMore: false, truncated: true, viewAllListId: "account.index" })}
        onLoadMore={vi.fn()}
        onViewAll={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
    expect(screen.getByRole("button", { name: /view all/i })).toBeTruthy();
  });

  it("truncation is disclosed even when there is nowhere to hand off to", () => {
    // Silence here would present a capped page as the whole set.
    render(<MetadataListGrid presentation={presentation({ surface: "RELATED", truncated: true, viewAllListId: null })} />);
    expect(screen.getByText(/showing the most recent/i)).toBeTruthy();
  });

  // ── X-RELATED-LIST-ACTIONS — row actions + post-create focus handoff ──────────────
  //
  // This is the capability the LEDGER blocker names: MetadataListGrid had no row
  // actions and no post-create focus handoff, which is why the hand-written Contacts
  // and Locations sections (AccountDetail.jsx) could not be wired through this
  // component without an accessibility regression. These tests establish that both now
  // exist, additively, without disturbing every caller that declares neither.

  const action = (over = {}) => ({
    id: "contact.edit",
    label: "Edit",
    denied: false,
    deniedReason: null,
    onActivate: vi.fn(),
    ...over,
  });

  describe("row actions", () => {
    it("a caller that declares no rowActions renders exactly as before — no actions column at all", () => {
      const { container } = render(<MetadataListGrid presentation={presentation()} />);
      expect(container.querySelectorAll("thead th")).toHaveLength(2);
      expect(container.querySelectorAll("tbody tr")[0].querySelectorAll("td")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    });

    it("an empty rowActions array is treated the same as no actions at all", () => {
      const { container } = render(<MetadataListGrid presentation={presentation()} rowActions={[]} />);
      expect(container.querySelectorAll("thead th")).toHaveLength(2);
    });

    it("an action activates by mouse click, receiving the row's routing key", () => {
      const onActivate = vi.fn();
      render(<MetadataListGrid presentation={presentation()} rowActions={[action({ onActivate })]} />);
      const [firstRowEdit] = screen.getAllByRole("button", { name: /edit/i });
      fireEvent.click(firstRowEdit);
      expect(onActivate).toHaveBeenCalledWith("acct-1");
    });

    it("an action activates by keyboard (Enter and Space), the same as by mouse", () => {
      const onActivate = vi.fn();
      render(<MetadataListGrid presentation={presentation()} rowActions={[action({ onActivate })]} />);
      const [firstRowEdit] = screen.getAllByRole("button", { name: /edit/i });

      firstRowEdit.focus();
      fireEvent.keyDown(firstRowEdit, { key: "Enter" });
      expect(onActivate).toHaveBeenCalledWith("acct-1");

      onActivate.mockClear();
      fireEvent.keyDown(firstRowEdit, { key: " " });
      expect(onActivate).toHaveBeenCalledWith("acct-1");
    });

    it("activating an action does not also trigger row navigation", () => {
      const onActivate = vi.fn();
      const onRowClick = vi.fn();
      render(
        <MetadataListGrid presentation={presentation()} onRowClick={onRowClick} rowActions={[action({ onActivate })]} />
      );
      const [firstRowEdit] = screen.getAllByRole("button", { name: /edit/i });

      fireEvent.click(firstRowEdit);
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onRowClick).not.toHaveBeenCalled();

      onActivate.mockClear();
      firstRowEdit.focus();
      fireEvent.keyDown(firstRowEdit, { key: "Enter" });
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it("the row itself still navigates normally when an action is not the click target", () => {
      const onRowClick = vi.fn();
      render(
        <MetadataListGrid presentation={presentation()} onRowClick={onRowClick} rowActions={[action()]} />
      );
      fireEvent.click(screen.getByText("Northside Foods"));
      expect(onRowClick).toHaveBeenCalledWith("acct-1");
    });

    it("a capability-denied action fails closed: visible and labeled, but disabled and unable to activate", () => {
      const onActivate = vi.fn();
      render(
        <MetadataListGrid
          presentation={presentation()}
          rowActions={[action({ onActivate, denied: true, deniedReason: 'You do not have access to "Edit".' })]}
        />
      );
      const [firstRowEdit] = screen.getAllByRole("button", { name: /edit/i });
      // Fails closed to genuinely unavailable, not hidden — the button is still in the
      // DOM with its label, not removed in a way that reads as "no actions exist".
      expect(firstRowEdit).toBeTruthy();
      expect(firstRowEdit.disabled).toBe(true);
      expect(firstRowEdit.getAttribute("title")).toMatch(/do not have access/i);

      fireEvent.click(firstRowEdit);
      expect(onActivate).not.toHaveBeenCalled();
    });

    it("the document id is never rendered as visible content in the actions cell either", () => {
      render(<MetadataListGrid presentation={presentation()} rowActions={[action()]} />);
      expect(screen.queryByText("acct-1")).toBeNull();
      expect(screen.queryByText("acct-2")).toBeNull();
    });

    it("focus is handed to the list container when an action removes the row that held it", () => {
      const onActivate = vi.fn();
      const { container, rerender } = render(
        <MetadataListGrid presentation={presentation()} rowActions={[action({ onActivate })]} />
      );
      const [firstRowEdit] = screen.getAllByRole("button", { name: /edit/i });
      firstRowEdit.focus();
      expect(document.activeElement).toBe(firstRowEdit);

      // Simulate the effect of the activated action: the row it lived on is gone from
      // the next presentation the caller passes down (e.g. a delete completed).
      const withoutFirstRow = presentation({
        rows: [{ key: "acct-2", cells: [{ fieldId: "name", value: "Harbor Grill" }, { fieldId: "status", value: "Inactive" }] }],
      });
      rerender(<MetadataListGrid presentation={withoutFirstRow} rowActions={[action({ onActivate })]} />);

      // The removed button is gone; focus must not be left stranded on <body> — the
      // list container is the sensible place to land it.
      expect(document.activeElement).toBe(container.querySelector(".fo-list-grid"));
    });
  });

  describe("post-create focus handoff", () => {
    it("moves focus to the row identified by focusRowKey once it is rendered, and reports the handoff done", () => {
      const onFocusHandled = vi.fn();
      const { container } = render(
        <MetadataListGrid presentation={presentation()} focusRowKey="acct-2" onFocusHandled={onFocusHandled} />
      );
      const targetRow = container.querySelectorAll("tbody tr")[1];
      expect(document.activeElement).toBe(targetRow);
      expect(onFocusHandled).toHaveBeenCalledTimes(1);
    });

    it("a focus target with no other reason to be focusable is reachable programmatically but not an extra tab stop", () => {
      const { container } = render(
        <MetadataListGrid presentation={presentation()} focusRowKey="acct-2" onFocusHandled={vi.fn()} />
      );
      const targetRow = container.querySelectorAll("tbody tr")[1];
      // -1: a valid focus() destination, not a normal Tab stop (mirrors the hand-written
      // AccountDetail.jsx pendingContactFocus/contactRowRef pattern).
      expect(targetRow.getAttribute("tabindex")).toBe("-1");
    });

    it("waits for the target row to actually appear before moving focus, rather than focusing nothing", () => {
      const onFocusHandled = vi.fn();
      const onlyOneRow = presentation({ rows: [presentation().rows[0]] });
      const { container, rerender } = render(
        <MetadataListGrid presentation={onlyOneRow} focusRowKey="acct-2" onFocusHandled={onFocusHandled} />
      );
      expect(onFocusHandled).not.toHaveBeenCalled();

      // The live subscription now delivers the newly created row.
      rerender(<MetadataListGrid presentation={presentation()} focusRowKey="acct-2" onFocusHandled={onFocusHandled} />);
      const targetRow = container.querySelectorAll("tbody tr")[1];
      expect(document.activeElement).toBe(targetRow);
      expect(onFocusHandled).toHaveBeenCalledTimes(1);
    });

    it("does not disturb a caller that declares no focusRowKey", () => {
      render(<MetadataListGrid presentation={presentation()} />);
      expect(document.activeElement).not.toBe(screen.getByText("Northside Foods").closest("tr"));
    });
  });
});

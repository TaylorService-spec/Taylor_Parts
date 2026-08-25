// THE PICKER MUST WRITE THE CANONICAL REF — never a label, never free text.
//
// The defect this closes was on the server (an arbitrary `ref` was a valid commercial line), but
// the surface is where the wrong value used to be produced: an input labelled "Item" whose typed
// contents went straight onto the line.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProductReferencePicker, { isSearchableKind } from "../src/modules/sales/ProductReferencePicker.jsx";
import { useProductReferenceSearch, PRODUCT_SEARCH_STATE as S } from "../src/hooks/useProductReferenceSearch.js";

vi.mock("../src/hooks/useProductReferenceSearch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useProductReferenceSearch: vi.fn() };
});

const PARTS = [
  { ref: "CW-P-0000", kind: "PART", displayName: "Evaporator Fan Motor", status: "ACTIVE" },
  { ref: "CW-P-0001", kind: "PART", displayName: "Drive Belt", status: "ACTIVE" },
];
const MODELS = [
  { ref: "taylor--c713", kind: "EQUIPMENT_MODEL", displayName: "Taylor C713", status: "ACTIVE" },
  { ref: "taylor--c161", kind: "EQUIPMENT_MODEL", displayName: "Taylor C161", status: "ACTIVE" },
];
const ready = (results, truncated = false) => ({ state: S.READY, results, truncated, refresh: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("kind routing", () => {
  it("knows which kinds have an authority to pick from", () => {
    expect(isSearchableKind("PART")).toBe(true);
    expect(isSearchableKind("EQUIPMENT_MODEL")).toBe(true);
    // No service-code catalog exists in the repository. Free text remains, rather than a picker
    // over nothing or a refusal that would delete a supported commercial kind.
    expect(isSearchableKind("SERVICE")).toBe(false);
  });

  it("SERVICE keeps a plain input, and it still writes through", () => {
    useProductReferenceSearch.mockReturnValue(ready([]));
    const onChange = vi.fn();
    render(<ProductReferencePicker kind="SERVICE" value="" onChange={onChange} lineNumber={1} />);
    fireEvent.change(screen.getByLabelText(/service description/i), { target: { value: "Annual maintenance" } });
    expect(onChange).toHaveBeenCalledWith("Annual maintenance");
  });
});

describe("equipment model picker", () => {
  it("STORES THE CANONICAL REF, not the display name", () => {
    useProductReferenceSearch.mockReturnValue(ready(MODELS));
    const onChange = vi.fn();
    render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={onChange} lineNumber={1} />);
    fireEvent.change(screen.getByLabelText(/equipment model/i), { target: { value: "taylor--c713" } });
    expect(onChange).toHaveBeenCalledWith("taylor--c713");
    // If the label were identity, renaming a model would rewrite what was sold.
    expect(onChange).not.toHaveBeenCalledWith("Taylor C713");
  });

  it("shows the name for confirmation WITH the id as disambiguator", () => {
    useProductReferenceSearch.mockReturnValue(ready(MODELS));
    render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByRole("option", { name: /Taylor C713 \(taylor--c713\)/ })).toBeTruthy();
  });

  it("keeps a LEGACY ref selectable and labels it truthfully", () => {
    // A line written before this control may name a model since removed. Silently clearing it would
    // discard what the record says; blanking it would read as "no item". Neither is this control's
    // call to make.
    useProductReferenceSearch.mockReturnValue(ready(MODELS));
    render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="gone--old" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByRole("option", { name: /gone--old — reference unavailable/ })).toBeTruthy();
  });

  it("tells DENIED and UNAVAILABLE apart, and neither reads as an empty catalog", () => {
    useProductReferenceSearch.mockReturnValue({ state: S.DENIED, results: [], truncated: false, refresh: vi.fn() });
    const { unmount } = render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/may not browse the model catalog/i)).toBeTruthy();
    expect(screen.queryByText(/No equipment models are set up/i)).toBeNull();
    unmount();

    useProductReferenceSearch.mockReturnValue({ state: S.UNAVAILABLE, results: [], truncated: false, refresh: vi.fn() });
    render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/model catalog is unavailable/i)).toBeTruthy();
  });

  it("a genuinely empty catalog says so, distinctly from loading", () => {
    useProductReferenceSearch.mockReturnValue({ state: S.LOADING, results: [], truncated: false, refresh: vi.fn() });
    const { unmount } = render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/Loading models/i)).toBeTruthy();
    unmount();
    useProductReferenceSearch.mockReturnValue(ready([]));
    render(<ProductReferencePicker kind="EQUIPMENT_MODEL" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/No equipment models are set up yet/i)).toBeTruthy();
  });
});

describe("part typeahead", () => {
  it("ARBITRARY TYPED TEXT IS NEVER COMMITTED AS THE ITEM", () => {
    // The whole defect, at the surface: typing is a QUERY, not a value. Only choosing a result
    // writes a ref.
    useProductReferenceSearch.mockReturnValue(ready([]));
    const onChange = vi.fn();
    render(<ProductReferencePicker kind="PART" value="" onChange={onChange} lineNumber={1} />);
    fireEvent.change(screen.getByLabelText(/part search/i), { target: { value: "asdfgh" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("choosing a result writes the canonical ref", () => {
    useProductReferenceSearch.mockReturnValue(ready(PARTS));
    const onChange = vi.fn();
    render(<ProductReferencePicker kind="PART" value="" onChange={onChange} lineNumber={1} />);
    fireEvent.click(screen.getByRole("button", { name: /Evaporator Fan Motor/ }));
    expect(onChange).toHaveBeenCalledWith("CW-P-0000");
    expect(onChange).not.toHaveBeenCalledWith("Evaporator Fan Motor");
  });

  it("IS KEYBOARD USABLE end to end", () => {
    useProductReferenceSearch.mockReturnValue(ready(PARTS));
    const onChange = vi.fn();
    render(<ProductReferencePicker kind="PART" value="" onChange={onChange} lineNumber={1} />);
    const input = screen.getByLabelText(/part search/i);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("CW-P-0001");
  });

  it("announces itself as a combobox that SUGGESTS rather than accepts", () => {
    useProductReferenceSearch.mockReturnValue(ready(PARTS));
    render(<ProductReferencePicker kind="PART" value="" onChange={vi.fn()} lineNumber={1} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("a CHOSEN part is a chip with Change — not an editable string", () => {
    // Once selected there is no text box whose contents could be mistaken for the identity, which
    // is exactly how free text became the stored ref.
    useProductReferenceSearch.mockReturnValue(ready(PARTS));
    render(<ProductReferencePicker kind="PART" value="CW-P-0000" onChange={vi.fn()} lineNumber={2} />);
    expect(screen.getByTestId("line-2-ref").textContent).toBe("CW-P-0000");
    expect(screen.queryByLabelText(/part search/i)).toBeNull();
    expect(screen.getByLabelText(/change part/i)).toBeTruthy();
  });

  it("Change reopens the search so the selection can be replaced", () => {
    useProductReferenceSearch.mockReturnValue(ready(PARTS));
    render(<ProductReferencePicker kind="PART" value="CW-P-0000" onChange={vi.fn()} lineNumber={1} />);
    fireEvent.click(screen.getByLabelText(/change part/i));
    expect(screen.getByLabelText(/part search/i)).toBeTruthy();
  });

  it("an UNRESOLVED legacy ref still shows what the record holds", () => {
    // The results do not contain it, so no name resolves. The value is shown rather than blanked --
    // a blank would read as "no item was ever chosen".
    useProductReferenceSearch.mockReturnValue(ready([]));
    render(<ProductReferencePicker kind="PART" value="LEGACY-999" onChange={vi.fn()} lineNumber={3} />);
    expect(screen.getByTestId("line-3-ref").textContent).toBe("LEGACY-999");
  });

  it("distinguishes searching, no-match, denied and unavailable", () => {
    for (const [state, pattern] of [
      [S.LOADING, /Searching/i],
      [S.DENIED, /may not search the parts catalog/i],
      [S.UNAVAILABLE, /parts catalog is unavailable/i],
    ]) {
      useProductReferenceSearch.mockReturnValue({ state, results: [], truncated: false, refresh: vi.fn() });
      const { unmount } = render(<ProductReferencePicker kind="PART" value="" onChange={vi.fn()} lineNumber={1} />);
      expect(screen.getByText(pattern)).toBeTruthy();
      unmount();
    }
    useProductReferenceSearch.mockReturnValue(ready([]));
    render(<ProductReferencePicker kind="PART" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/No parts match that/i)).toBeTruthy();
  });

  it("says when there are MORE matches rather than implying the page is everything", () => {
    useProductReferenceSearch.mockReturnValue(ready(PARTS, true));
    render(<ProductReferencePicker kind="PART" value="" onChange={vi.fn()} lineNumber={1} />);
    expect(screen.getByText(/refine your search/i)).toBeTruthy();
  });
});

// SupplierPicker -- RENDER tests (vitest + jsdom). Proves the governed-selection honest states: loading,
// denied (fail-closed, no free-text), unavailable, empty-active, selectable list (ACTIVE only) + selection
// hands the caller the ENTITY, and the selected view + Change. Pure props-driven component (no mocks).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SupplierPicker from "../src/shared/supplier/SupplierPicker.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const SUPPLIERS = [
  { id: "s1", name: "Acme Supply", status: "ACTIVE", vendorNumber: "V-1" },
  { id: "s2", name: "Beta Parts", status: "INACTIVE" },
  { id: "s3", name: "Acme Tools", status: "ACTIVE" },
];

describe("SupplierPicker honest states + governed selection", () => {
  it("loading -> shows a loading state, no picker", () => {
    render(<SupplierPicker loading error={null} suppliers={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/Loading suppliers/i)).toBeTruthy();
  });

  it("permission-denied -> fail-closed message, NO input (no free-text fallback)", () => {
    render(<SupplierPicker loading={false} error="permission-denied" suppliers={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/do not have access/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("unavailable -> honest unavailable message, no input", () => {
    render(<SupplierPicker loading={false} error="unknown" suppliers={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("no active suppliers -> honest empty state, no free-text", () => {
    render(<SupplierPicker loading={false} error={null} suppliers={[{ id: "s2", name: "Beta", status: "INACTIVE" }]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/No active suppliers/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lists ONLY active suppliers; selecting one hands the caller the ENTITY", () => {
    const onSelect = vi.fn();
    render(<SupplierPicker loading={false} error={null} suppliers={SUPPLIERS} selected={null} onSelect={onSelect} />);
    // INACTIVE Beta Parts is not offered.
    expect(screen.queryByText("Beta Parts")).toBeNull();
    const acme = screen.getByText("Acme Supply");
    fireEvent.click(acme);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "s1", name: "Acme Supply", status: "ACTIVE" });
  });

  it("selected -> shows the chosen supplier + Change clears it", () => {
    const onSelect = vi.fn();
    render(<SupplierPicker loading={false} error={null} suppliers={SUPPLIERS} selected={{ id: "s1", name: "Acme Supply", status: "ACTIVE" }} onSelect={onSelect} />);
    expect(screen.getByText("Acme Supply")).toBeTruthy();
    expect(screen.getByText(/Active/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Change supplier/i));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

// The Transfer form must not present an unloaded or unreadable truck list as "no trucks".
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TransferOrderForm from "../src/modules/inventory/TransferOrderForm.jsx";

afterEach(cleanup);

const mount = (truckOptionsStatus, truckOptions = []) => render(
  <TransferOrderForm warehouseOptions={[{ id: "WH-1", label: "Main" }]} truckOptions={truckOptions}
    truckOptionsStatus={truckOptionsStatus} submitting={false} onSubmit={async () => ({ ok: true })} onCancel={() => {}} />,
);

describe("TransferOrderForm — truck list status", () => {
  it("a FAILED truck read says so when Truck is chosen", () => {
    mount("failed");
    expect(document.body.textContent).not.toMatch(/Trucks could not be loaded/);
    fireEvent.change(screen.getByLabelText("Origin type"), { target: { value: "MOBILE" } });
    expect(document.body.textContent).toMatch(/Trucks could not be loaded/);
  });
  it("a LOADING truck read says it is loading", () => {
    mount("loading");
    fireEvent.change(screen.getByLabelText("Destination type"), { target: { value: "MOBILE" } });
    expect(document.body.textContent).toMatch(/Trucks are still loading/);
  });
  it("a READY truck read lists trucks and adds no notice (and the prop defaults to ready)", () => {
    render(<TransferOrderForm warehouseOptions={[]} truckOptions={[{ id: "T-1", label: "Truck 1" }]} submitting={false} onSubmit={async () => ({ ok: true })} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Origin type"), { target: { value: "MOBILE" } });
    expect(screen.getByRole("option", { name: "Truck 1" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Trucks (could not|are still)/);
  });
});

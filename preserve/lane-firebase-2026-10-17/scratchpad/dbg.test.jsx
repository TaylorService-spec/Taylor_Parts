import { it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ReturnIntakeScan from "../src/modules/scan/ReturnIntakeScan.jsx";
it("dbg", async () => {
  const opts = vi.fn().mockResolvedValue({ companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }], warehouses: [] });
  const rec = vi.fn().mockResolvedValue({ outcome: "recorded", returnId: "r", partId: "P", quantity: 1 });
  let clock = 0;
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake: rec, listReturnIntakeOptions: opts }, scanInputDeps: { now: () => (clock += 1000) } }} />);
  fireEvent.change(screen.getByLabelText(/scan returned part/i), { target: { value: "P" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  console.log("C opts calls", opts.mock.calls.length);
  fireEvent.change(screen.getByLabelText(/what condition is it in/i), { target: { value: "OPENED" } });
  console.log("D opts calls", opts.mock.calls.length);
  await act(async () => {});
  console.log("D2", document.body.textContent.slice(0, 300));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /record this return/i })); });
  console.log("E rec", rec.mock.calls.length, opts.mock.calls.length);
}, 4000);

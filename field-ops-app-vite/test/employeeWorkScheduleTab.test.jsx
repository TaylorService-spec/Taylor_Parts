// Scheduling PR-2 — the Employee record's Work Schedule tab.
//
// What must hold: the tab renders the governed read and nothing else; a refusal is a refusal, never an empty or partial
// schedule; editing is HELD (no capability call, no command, no control) while the readiness seam is off; and when it is
// on, the editor sends exactly the governed command's payload and never a default shift.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import EmployeeWorkSchedule from "../src/modules/administration/EmployeeWorkSchedule.jsx";

afterEach(cleanup);

const DAY = 86_400_000;
const SCHEDULE = {
  scheduleId: "tws_1", operatingCompanyId: null, timeZone: "America/Phoenix", effectiveFrom: "2026-09-01", effectiveTo: null,
  status: "CURRENT", recordedAt: "2026-08-30T12:00:00.000Z",
  weeklyHours: { 1: [{ start: "07:00", end: "12:00" }, { start: "12:30", end: "16:00" }], 2: [{ start: "07:00", end: "16:00" }] },
};
const READ = (over = {}) => ({
  employeeId: "emp-1", operatingCompanyId: "taylor", schedules: [SCHEDULE], schedulesHasMore: false,
  exceptions: [{ unavailabilityId: "tua_1", kind: "PTO", startMillis: Date.now() + DAY, endMillis: Date.now() + 2 * DAY, ended: false, reason: "Vacation" }],
  exceptionsWindow: { startMillis: 0, endMillis: 1 }, ...over,
});

/** A Work Order API double: answers by operation; records every call. */
function clientWith(answers) {
  const call = vi.fn(async (operation) => {
    const a = answers[operation];
    if (a === undefined) throw new Error(`unexpected call: ${operation}`);
    return typeof a === "function" ? a() : a;
  });
  return { call };
}
const ok = (result) => ({ ok: true, result });
const ops = (client) => client.call.mock.calls.map((c) => c[0]);

describe("the tab shows the governed schedule", () => {
  it("renders the current week with breaks, and the exceptions", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: ok(READ()) });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} />);
    const week = await screen.findByRole("table", { name: /Weekly working hours/ });
    expect(within(week).getByText("7:00a–12:00p · 30 min break · 12:30p–4:00p")).toBeTruthy();
    expect(within(week).getAllByText("Off").length).toBe(5);
    expect(screen.getByText(/America\/Phoenix · applies to All companies/)).toBeTruthy();
    expect(screen.getByText(/Vacation/)).toBeTruthy();
    expect(client.call).toHaveBeenCalledWith("readEmployeeWorkSchedule", { employeeId: "emp-1" });
  });

  it("no schedule is said in words, with no default hours anywhere", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: ok(READ({ schedules: [], exceptions: [] })) });
    const { container } = render(<EmployeeWorkSchedule employeeId="emp-1" client={client} />);
    expect(await screen.findByText(/No working schedule recorded/)).toBeTruthy();
    expect(container.textContent).toMatch(/never assumes default hours/);
    expect(container.textContent).not.toMatch(/7:00a|07:00/);
  });

  it("a refusal (SCH-D2) is a refusal — no schedule, no partial data", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_MISSING" } });
    const { container } = render(<EmployeeWorkSchedule employeeId="emp-1" client={client} />);
    expect(await screen.findByText(/visible to scheduling roles that can see this Employee's record and operating company/)).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("an Employee outside the caller's companies reads exactly like a refusal (G-9 rule)", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: { ok: false, code: "NOT_FOUND", reason: "EMPLOYEE_NOT_FOUND" } });
    render(<EmployeeWorkSchedule employeeId="emp-x" client={client} />);
    expect(await screen.findByText(/visible to scheduling roles/)).toBeTruthy();
  });

  it("a failed read says so and offers Retry, assuming nothing", async () => {
    let n = 0;
    const client = clientWith({ readEmployeeWorkSchedule: () => (n++ === 0 ? { ok: false, code: "UNREACHABLE" } : ok(READ())) });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be read/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table", { name: /Weekly working hours/ })).toBeTruthy();
  });
});

describe("editing is HELD while the readiness seam is off (Owner, 2026-10-16)", () => {
  it("no capability call, no command, no edit control — even for a scheduler", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: ok(READ()), readMyWorkOrderCapabilities: ok({ capabilities: ["workOrder.lifecycle.schedule"] }) });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} />);
    await screen.findByRole("table", { name: /Weekly working hours/ });
    expect(ops(client)).toEqual(["readEmployeeWorkSchedule"]);
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add exception|End early/ })).toBeNull();
  });

  it("with the seam on, a caller without workOrder.lifecycle.schedule still gets no controls", async () => {
    const client = clientWith({ readEmployeeWorkSchedule: ok(READ()), readMyWorkOrderCapabilities: ok({ capabilities: ["workOrder.lifecycle.dispatch"] }) });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} editReady />);
    await screen.findByRole("table", { name: /Weekly working hours/ });
    await waitFor(() => expect(ops(client)).toContain("readMyWorkOrderCapabilities"));
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
  });
});

describe("with the seam on and the capability held, edits go through the governed commands", () => {
  const scheduler = (extra = {}) => clientWith({
    readEmployeeWorkSchedule: ok(READ({ schedules: [] })),
    readMyWorkOrderCapabilities: ok({ capabilities: ["workOrder.lifecycle.schedule"] }),
    ...extra,
  });

  it("an empty new schedule is refused locally and sends nothing — never a default shift", async () => {
    const client = scheduler();
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} editReady />);
    fireEvent.click(await screen.findByRole("button", { name: "Record schedule" }));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/Phoenix" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new schedule" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/never assumed/);
    expect(ops(client)).not.toContain("setTechnicianWorkingHours");
  });

  it("sends exactly the setTechnicianWorkingHours contract, then re-reads", async () => {
    const client = scheduler({ setTechnicianWorkingHours: ok({ scheduleId: "tws_new" }) });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} editReady />);
    fireEvent.click(await screen.findByRole("button", { name: "Record schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Mon interval" }));
    fireEvent.change(screen.getByLabelText("Mon interval 1 start"), { target: { value: "07:00" } });
    fireEvent.change(screen.getByLabelText("Mon interval 1 end"), { target: { value: "16:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy Mon to Tue–Fri" }));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/Phoenix" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "New hire" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new schedule" }));
    await waitFor(() => expect(ops(client)).toContain("setTechnicianWorkingHours"));
    const [, payload] = client.call.mock.calls.find((c) => c[0] === "setTechnicianWorkingHours");
    const shift = [{ start: "07:00", end: "16:00" }];
    expect(payload).toEqual({
      employeeId: "emp-1", timeZone: "America/Phoenix", effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      operatingCompanyId: null, reason: "New hire", weeklyHours: { 1: shift, 2: shift, 3: shift, 4: shift, 5: shift },
    });
    await waitFor(() => expect(ops(client).filter((o) => o === "readEmployeeWorkSchedule").length).toBe(2));
  });

  it("a server refusal is shown in words and nothing claims success", async () => {
    const client = scheduler({ setTechnicianWorkingHours: { ok: false, code: "FORBIDDEN", reason: "COMPANY_AUTHORITY_REQUIRED" } });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} editReady />);
    fireEvent.click(await screen.findByRole("button", { name: "Record schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Tue interval" }));
    fireEvent.change(screen.getByLabelText("Tue interval 1 start"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Tue interval 1 end"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/Phoenix" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new schedule" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not have access to this Employee's operating company/);
  });

  it("ending an exception early requires a reason and calls the governed command", async () => {
    const client = clientWith({
      readEmployeeWorkSchedule: ok(READ()),
      readMyWorkOrderCapabilities: ok({ capabilities: ["workOrder.lifecycle.schedule"] }),
      endTechnicianUnavailability: ok({ unavailabilityId: "tua_1", withdrawn: true }),
    });
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client} editReady />);
    fireEvent.click(await screen.findByRole("button", { name: "End early" }));
    const submit = screen.getByRole("button", { name: "End exception" });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Cancelled trip" } });
    fireEvent.click(submit);
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("endTechnicianUnavailability", { unavailabilityId: "tua_1", reason: "Cancelled trip" }));
  });
});

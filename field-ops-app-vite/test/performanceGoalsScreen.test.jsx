// Analysis > Goals (G-1; DECISIONS #G-1; resolves OD-B4-3): the screen offers exactly what the server allows, and decides nothing.
//
//   * the pickers hold what the server's options read states (metrics the caller has authority over, the companies and warehouses they reach, the people beneath
//     them -- never themselves); a metric offers only its own scopes;
//   * every control is offered only to a holder of its own capability: Set a target (create), Replace (supersede), Approve (approve), Retire (retire);
//   * a draft the caller authored is not approvable by them (the screen says so; the server refuses it anyway);
//   * an amount is dollars and cents, stored as whole minor units with its currency; a count is a whole number;
//   * a decision (approve / retire) states its reason; a refusal is shown in the server's own words and nothing on screen changes;
//   * the caller's idempotency key is kept for ONE attempt: reused after an unavailable answer, renewed after a definitive one;
//   * nothing is optimistic: the versions are re-read after every change.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/hooks/useGovernedEmployeeDirectory.js", async () => {
  const actual = await vi.importActual("../src/domain/actorDisplayName");
  return {
    useGovernedEmployeeDirectory: () => ({
      byEmployeeId: new Map([["e-rep", { id: "e-rep", displayName: "Riley Rep" }], ["e-tech", { id: "e-tech", displayName: "Tess Tech" }]]),
      byUserId: new Map([["p-me", { id: "p-me", displayName: "Me Manager" }], ["p-other", { id: "p-other", displayName: "Olive Other" }]]),
    }),
    resolveActorDisplayName: actual.resolveActorDisplayName,
  };
});

const { default: PerformanceGoals, toMinorUnits, describeTarget } = await import("../src/modules/analysis/PerformanceGoals.jsx");
const { PERFORMANCE_GOAL_GATE: GATE } = await import("../src/access/shellCapabilityGates.js");

const has = (...keys) => (key) => keys.includes(key);
const ALL = has(GATE.create, GATE.supersede, GATE.approve, GATE.retire);

const options = (over = {}) => ({
  principalId: "p-me",
  verbs: { create: true, supersede: true, approve: true, retire: true },
  metrics: [
    { metricId: "service.workOrder.pastDue.count", displayName: "Past due scheduled work", unit: "COUNT", allowedDirections: ["AT_MOST"], supportedScopes: ["FIRM"] },
    { metricId: "technician.workOrder.open.count", displayName: "My open assigned work", unit: "COUNT", allowedDirections: ["AT_MOST"], supportedScopes: ["EMPLOYEE"] },
    { metricId: "sales.billed.amount", displayName: "Billed", unit: "CURRENCY_MINOR", allowedDirections: ["AT_LEAST"], supportedScopes: ["EMPLOYEE", "OPERATING_COMPANY", "FIRM"] },
    { metricId: "receiving.purchaseOrder.receivable.count", displayName: "Purchase orders awaiting receipt", unit: "COUNT", allowedDirections: ["AT_MOST"], supportedScopes: ["LOCATION", "FIRM"] },
  ],
  companies: [{ id: "taylor", name: "Taylor Parts" }],
  warehouses: [{ id: "wh-1", name: "North Warehouse" }],
  employeeIds: ["e-rep", "e-tech"],
  ...over,
});
const goal = (over = {}) => ({
  goalId: "goal_1", metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null, targetValue: 5, unit: "COUNT", direction: "AT_MOST", currency: null,
  effectiveFrom: "2026-11-01", effectiveTo: null, status: "APPROVED", version: 1, createdByUid: "p-other", createdAtMillis: 1, approvedByUid: "p-me", approvedAtMillis: 2, supersedesGoalId: null, ...over,
});
const fakeClient = (over = {}) => ({
  loadOptions: vi.fn(async () => ({ ok: true, options: options() })),
  listVersions: vi.fn(async () => ({ ok: true, versions: [goal()] })),
  createDraft: vi.fn(async () => ({ ok: true, replayed: false, goal: { goalId: "goal_2", status: "DRAFT", version: 2 } })),
  approve: vi.fn(async () => ({ ok: true, replayed: false, result: { status: "APPROVED", goalId: "goal_2", version: 2 } })),
  retire: vi.fn(async () => ({ ok: true, replayed: false, result: { status: "RETIRED", goalId: "goal_1", closedAt: "2026-12-20" } })),
  ...over,
});

/** Choose a FIRM target on the past-due metric and open its versions. */
async function openFirm(client, hasCapability = ALL) {
  render(<PerformanceGoals hasCapability={hasCapability} client={client} />);
  await screen.findByRole("region", { name: "Choose a target" });
  fireEvent.change(screen.getByLabelText(/Measure/), { target: { value: "service.workOrder.pastDue.count" } });
  fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "FIRM" } });
  fireEvent.click(screen.getByRole("button", { name: "Show this target" }));
  return screen.findByRole("region", { name: "Target versions" });
}

describe("the pure helpers", () => {
  it("an amount is dollars and cents in, whole minor units out -- never a rounded surprise", () => {
    expect(toMinorUnits("12500")).toBe(1250000);
    expect(toMinorUnits("12500.5")).toBe(1250050);
    expect(toMinorUnits("0.05")).toBe(5);
    for (const bad of ["", "1.234", "-1", "1,000", "abc", "12.", ".5"]) expect(toMinorUnits(bad)).toBeNull();
  });
  it("a target is stated with its unit and direction", () => {
    expect(describeTarget(goal())).toBe("At most 5");
    expect(describeTarget(goal({ unit: "CURRENCY_MINOR", currency: "USD", targetValue: 1250050, direction: "AT_LEAST" }))).toBe("At least 12500.50 USD");
  });
});

describe("the options", () => {
  it("states a refusal as a refusal and an outage as an outage; shows nothing to choose from when the caller has authority over no measure", async () => {
    const { unmount } = render(<PerformanceGoals hasCapability={ALL} client={fakeClient({ loadOptions: vi.fn(async () => ({ ok: false, outcome: "denied", message: "this requires performance.goal.create" })) })} />);
    expect(await screen.findByText("Goals unavailable")).toBeTruthy();
    expect(screen.getByText(/does not include setting performance goals/)).toBeTruthy();
    expect(screen.queryByText(/performance\.goal\.create/)).toBeNull();
    unmount();
    render(<PerformanceGoals hasCapability={ALL} client={fakeClient({ loadOptions: vi.fn(async () => ({ ok: false, outcome: "unavailable", reason: null })) })} />);
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  });

  it("offers exactly the measures the server states, each with only its own scopes, and the people, companies and warehouses it states", async () => {
    render(<PerformanceGoals hasCapability={ALL} client={fakeClient()} />);
    await screen.findByRole("region", { name: "Choose a target" });
    const measure = screen.getByLabelText(/Measure/);
    expect([...measure.options].map((o) => o.textContent)).toEqual(["Choose a measure", "Past due scheduled work", "My open assigned work", "Billed", "Purchase orders awaiting receipt"]);
    const forSelect = screen.getByLabelText(/^For/);
    expect(forSelect.disabled).toBe(true);
    fireEvent.change(measure, { target: { value: "technician.workOrder.open.count" } });
    expect([...forSelect.options].map((o) => o.textContent)).toEqual(["Choose where it applies", "Employee"]);
    fireEvent.change(forSelect, { target: { value: "EMPLOYEE" } });
    expect([...screen.getByLabelText(/^Employee/).options].map((o) => o.textContent)).toEqual(["Choose an employee", "Riley Rep", "Tess Tech"]);
    expect(screen.getByText(/never for yourself/)).toBeTruthy();
    fireEvent.change(measure, { target: { value: "sales.billed.amount" } });
    expect([...screen.getByLabelText(/^For/).options].map((o) => o.textContent)).toEqual(["Choose where it applies", "Employee", "Operating company", "Whole firm"]);
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "OPERATING_COMPANY" } });
    expect([...screen.getByLabelText(/^Company/).options].map((o) => o.textContent)).toEqual(["Choose a company", "Taylor Parts"]);
    fireEvent.change(measure, { target: { value: "receiving.purchaseOrder.receivable.count" } });
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "LOCATION" } });
    expect([...screen.getByLabelText(/^Warehouse/).options].map((o) => o.textContent)).toEqual(["Choose a warehouse", "North Warehouse"]);
  });

  it("says so when the caller has authority over no measure", async () => {
    render(<PerformanceGoals hasCapability={ALL} client={fakeClient({ loadOptions: vi.fn(async () => ({ ok: true, options: options({ metrics: [] }) })) })} />);
    expect(await screen.findByText("Nothing to set targets on")).toBeTruthy();
  });

  it("will not look up a target until the whole target is chosen", async () => {
    const client = fakeClient();
    render(<PerformanceGoals hasCapability={ALL} client={client} />);
    await screen.findByRole("region", { name: "Choose a target" });
    fireEvent.change(screen.getByLabelText(/Measure/), { target: { value: "technician.workOrder.open.count" } });
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "EMPLOYEE" } });
    expect(screen.getByRole("button", { name: "Show this target" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "e-rep" } });
    expect(screen.getByRole("button", { name: "Show this target" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show this target" }));
    await waitFor(() => expect(client.listVersions).toHaveBeenCalledWith({ metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: "e-rep" }));
  });
});

describe("the versions", () => {
  it("lists every version with its status, dates and the people who set and approved it; a FIRM target is looked up with no scope id", async () => {
    const client = fakeClient({ listVersions: vi.fn(async () => ({ ok: true, versions: [
      goal({ goalId: "g1", status: "SUPERSEDED", effectiveTo: "2026-11-30" }),
      goal({ goalId: "g2", version: 2, targetValue: 3, effectiveFrom: "2026-12-01", supersedesGoalId: "g1" }),
      goal({ goalId: "g3", version: 3, status: "DRAFT", createdByUid: "p-other", approvedByUid: null, approvedAtMillis: null, effectiveFrom: "2027-01-01" }),
    ] })) });
    const section = await openFirm(client);
    expect(client.listVersions).toHaveBeenCalledWith({ metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null });
    const table = within(section).getByRole("table", { name: "Target versions" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Replaced")).toBeTruthy();
    expect(within(rows[0]).getByText("2026-11-30")).toBeTruthy();
    expect(within(rows[1]).getByText("In force")).toBeTruthy();
    expect(within(rows[1]).getByText("At most 3")).toBeTruthy();
    expect(within(rows[1]).getByText("Open-ended")).toBeTruthy();
    expect(within(rows[2]).getByText("Draft")).toBeTruthy();
    expect(within(rows[2]).getAllByText("Olive Other").length).toBeGreaterThan(0);
  });

  it("states no target as no target, a refusal as a refusal, an outage as an outage", async () => {
    const empty = await openFirm(fakeClient({ listVersions: vi.fn(async () => ({ ok: true, versions: [] })) }));
    expect(within(empty).getByText("No target set")).toBeTruthy();
  });
  it("denied", async () => {
    render(<PerformanceGoals hasCapability={ALL} client={fakeClient({ listVersions: vi.fn(async () => ({ ok: false, outcome: "denied" })) })} />);
    await screen.findByRole("region", { name: "Choose a target" });
    fireEvent.change(screen.getByLabelText(/Measure/), { target: { value: "service.workOrder.pastDue.count" } });
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "FIRM" } });
    fireEvent.click(screen.getByRole("button", { name: "Show this target" }));
    expect(await screen.findByText("That target is outside what you can see.")).toBeTruthy();
  });
  it("unavailable shows no server text", async () => {
    render(<PerformanceGoals hasCapability={ALL} client={fakeClient({ listVersions: vi.fn(async () => ({ ok: false, outcome: "unavailable", message: "SELECT secret" })) })} />);
    await screen.findByRole("region", { name: "Choose a target" });
    fireEvent.change(screen.getByLabelText(/Measure/), { target: { value: "service.workOrder.pastDue.count" } });
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "FIRM" } });
    fireEvent.click(screen.getByRole("button", { name: "Show this target" }));
    expect(await screen.findByText(/versions could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/secret/)).toBeNull();
  });
});

describe("controls are offered only to capability holders, narrowed by authorship", () => {
  const versions = [
    goal({ goalId: "g-live", version: 1, status: "APPROVED" }),
    goal({ goalId: "g-theirs", version: 2, status: "DRAFT", createdByUid: "p-other", approvedByUid: null, effectiveFrom: "2027-01-01" }),
    goal({ goalId: "g-mine", version: 3, status: "DRAFT", createdByUid: "p-me", approvedByUid: null, effectiveFrom: "2027-02-01" }),
  ];
  const client = () => fakeClient({ listVersions: vi.fn(async () => ({ ok: true, versions })) });

  it("a holder of every capability: Set a target, Replace and Retire on the approved one, Approve only on a draft someone ELSE set", async () => {
    const section = await openFirm(client());
    expect(within(section).getByRole("button", { name: "Set a target" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Replace version 1" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Retire version 1" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Approve version 2" })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Approve version 3" })).toBeNull();
    expect(within(section).getByText("You set this one, so someone else approves it.")).toBeTruthy();
  });

  it("an approver alone sees Approve and nothing else", async () => {
    const section = await openFirm(client(), has(GATE.approve));
    expect(within(section).getByRole("button", { name: "Approve version 2" })).toBeTruthy();
    for (const name of ["Set a target", "Replace version 1", "Retire version 1"]) expect(within(section).queryByRole("button", { name })).toBeNull();
  });
  it("a creator alone can set a target but not replace, approve or retire one", async () => {
    const section = await openFirm(client(), has(GATE.create));
    expect(within(section).getByRole("button", { name: "Set a target" })).toBeTruthy();
    for (const name of ["Replace version 1", "Retire version 1", "Approve version 2"]) expect(within(section).queryByRole("button", { name })).toBeNull();
  });
  it("Replace needs the supersede capability and Retire the retire capability, each on its own", async () => {
    const a = await openFirm(client(), has(GATE.supersede));
    expect(within(a).getByRole("button", { name: "Replace version 1" })).toBeTruthy();
    expect(within(a).queryByRole("button", { name: "Retire version 1" })).toBeNull();
  });
  it("a holder of no authoring capability sees the versions and no control", async () => {
    const section = await openFirm(client(), has(GATE.read));
    expect(within(section).getAllByRole("row")).toHaveLength(4);
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("setting a target", () => {
  const fill = (value, extra = {}) => {
    fireEvent.change(screen.getByLabelText(/^Target \(required\)/), { target: { value } });
    if (extra.direction) fireEvent.change(screen.getByLabelText(/Counts as met/), { target: { value: extra.direction } });
    if (extra.from) fireEvent.change(screen.getByLabelText(/Takes effect on/), { target: { value: extra.from } });
  };

  it("a count is a whole number; the server's key, target and dates travel; the versions are re-read and the success is said", async () => {
    const client = fakeClient();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Set a target" }));
    const form = await screen.findByRole("form", { name: "Set a target" });
    expect(within(form).getByText(/does not apply until someone else approves it/)).toBeTruthy();
    fill("1.5");
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("A target is a whole number.")).toBeTruthy();
    expect(client.createDraft).not.toHaveBeenCalled();
    fill("4", { from: "2026-12-01" });
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledTimes(1));
    const sent = client.createDraft.mock.calls[0][0];
    expect(sent).toMatchObject({ metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null, targetValue: 4, unit: "COUNT", direction: "AT_MOST",
      currency: null, effectiveFrom: "2026-12-01", effectiveTo: null, supersedesGoalId: null });
    expect(sent.idempotencyKey).toMatch(/^goal-create-/);
    expect(await screen.findByText(/Saved the target as a draft/)).toBeTruthy();
    await waitFor(() => expect(client.listVersions.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("form", { name: "Set a target" })).toBeNull();
  });

  it("an amount is dollars and cents with a currency, sent as whole minor units; the metric's only direction is chosen for the caller", async () => {
    const client = fakeClient();
    render(<PerformanceGoals hasCapability={ALL} client={client} />);
    await screen.findByRole("region", { name: "Choose a target" });
    fireEvent.change(screen.getByLabelText(/Measure/), { target: { value: "sales.billed.amount" } });
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: "OPERATING_COMPANY" } });
    fireEvent.change(screen.getByLabelText(/^Company/), { target: { value: "taylor" } });
    fireEvent.click(screen.getByRole("button", { name: "Show this target" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set a target" }));
    const form = await screen.findByRole("form", { name: "Set a target" });
    expect(within(form).getByLabelText(/Counts as met/).value).toBe("AT_LEAST");
    fireEvent.change(within(form).getByLabelText(/^Amount/), { target: { value: "12500.5" } });
    fireEvent.change(within(form).getByLabelText(/^Currency/), { target: { value: "usd" } });
    fireEvent.change(within(form).getByLabelText(/Ends on/), { target: { value: "2026-12-31" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledTimes(1));
    expect(client.createDraft.mock.calls[0][0]).toMatchObject({ targetScopeType: "OPERATING_COMPANY", targetScopeId: "taylor", targetValue: 1250050, unit: "CURRENCY_MINOR",
      currency: "USD", direction: "AT_LEAST", effectiveTo: "2026-12-31" });
    // A malformed amount is refused here, with no call.
    fireEvent.click(await screen.findByRole("button", { name: "Set a target" }));
    const again = await screen.findByRole("form", { name: "Set a target" });
    fireEvent.change(within(again).getByLabelText(/^Amount/), { target: { value: "12,500" } });
    fireEvent.click(within(again).getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/dollars and cents/)).toBeTruthy();
    expect(client.createDraft).toHaveBeenCalledTimes(1);
  });

  it("a refusal is shown in the server's own words and the form stays; the key is kept after an outage and renewed after a definitive answer", async () => {
    const createDraft = vi.fn()
      .mockResolvedValueOnce({ ok: false, outcome: "unavailable", reason: null })
      .mockResolvedValueOnce({ ok: false, outcome: "conflict", reason: "GOAL_ALREADY_IN_FORCE", message: "an APPROVED target (version 1) already covers part of that window" })
      .mockResolvedValueOnce({ ok: true, replayed: false, goal: { goalId: "goal_9", status: "DRAFT", version: 2 } });
    const section = await openFirm(fakeClient({ createDraft }));
    fireEvent.click(within(section).getByRole("button", { name: "Set a target" }));
    const form = await screen.findByRole("form", { name: "Set a target" });
    fill("4", { from: "2026-12-01" });
    const save = () => fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    save();
    expect(await within(form).findByText(/Nothing was changed; try again/)).toBeTruthy();
    save();
    expect(await within(form).findByText(/already covers part of that window/)).toBeTruthy();
    save();
    await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(3));
    const keys = createDraft.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys[1]).toBe(keys[0]); // retried after an outage: the SAME key
    expect(keys[2]).not.toBe(keys[1]); // after a definitive refusal: a new attempt
    expect(await screen.findByText(/Saved the target as a draft/)).toBeTruthy();
  });

  it("Replace names its predecessor and takes effect later; the success says someone else approves it", async () => {
    const client = fakeClient();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Replace version 1" }));
    const form = await screen.findByRole("form", { name: "Replace a target" });
    expect(within(form).getByText(/closed the day before/)).toBeTruthy();
    expect(within(form).getByText(/Must be after 2026-11-01/)).toBeTruthy();
    expect(within(form).getByLabelText(/Takes effect on/).value).toBe("");
    fill("3", { from: "2026-12-01" });
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledTimes(1));
    expect(client.createDraft.mock.calls[0][0]).toMatchObject({ supersedesGoalId: "goal_1", effectiveFrom: "2026-12-01", targetValue: 3 });
    expect(await screen.findByText(/replacement draft \(version 2\)/)).toBeTruthy();
  });

  it("Cancel closes the form without a call", async () => {
    const client = fakeClient();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Set a target" }));
    const form = await screen.findByRole("form", { name: "Set a target" });
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Set a target" })).toBeNull();
    expect(client.createDraft).not.toHaveBeenCalled();
  });
});

describe("approving and retiring", () => {
  const draftFirst = () => fakeClient({ listVersions: vi.fn(async () => ({ ok: true, versions: [
    goal({ goalId: "g-live" }),
    goal({ goalId: "g-draft", version: 2, status: "DRAFT", createdByUid: "p-other", approvedByUid: null, targetValue: 3, effectiveFrom: "2027-01-01" }),
  ] })) });

  it("approving needs a reason; the call carries goal, reason and key; the versions are re-read", async () => {
    const client = draftFirst();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Approve version 2" }));
    const form = await screen.findByRole("form", { name: "Approve a target" });
    expect(within(form).getByText(/Approve version 2: At most 3/)).toBeTruthy();
    const confirm = within(form).getByRole("button", { name: "Confirm approval" });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/Why is this approved/), { target: { value: "Agreed with operations" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(client.approve).toHaveBeenCalledTimes(1));
    expect(client.approve.mock.calls[0][0]).toMatchObject({ goalId: "g-draft", reason: "Agreed with operations" });
    expect(client.approve.mock.calls[0][0].idempotencyKey).toMatch(/^goal-approve-/);
    expect(await screen.findByText(/Approved\. The target is in force/)).toBeTruthy();
    await waitFor(() => expect(client.listVersions.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("form", { name: "Approve a target" })).toBeNull();
  });

  it("a refusal (the server's own words) leaves the panel open and changes nothing", async () => {
    const approve = vi.fn(async () => ({ ok: false, outcome: "denied", reason: "SELF_TARGETING_FORBIDDEN", message: "an employee does not manage their own target -- a goal for you is authored by someone above you" }));
    const client = fakeClient({ approve, listVersions: draftFirst().listVersions });
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Approve version 2" }));
    const form = await screen.findByRole("form", { name: "Approve a target" });
    fireEvent.change(within(form).getByLabelText(/Why is this approved/), { target: { value: "ok" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirm approval" }));
    expect(await within(form).findByText(/does not manage their own target/)).toBeTruthy();
    expect(client.listVersions).toHaveBeenCalledTimes(1); // nothing re-read: nothing changed
    expect(screen.queryByText(/Approved\./)).toBeNull();
  });

  it("retiring states its reason and says the history stays on record", async () => {
    const client = draftFirst();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Retire version 1" }));
    const form = await screen.findByRole("form", { name: "Retire a target" });
    expect(within(form).getByText(/stays on record/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Why is this retired/), { target: { value: "We stopped measuring this" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirm retirement" }));
    await waitFor(() => expect(client.retire).toHaveBeenCalledTimes(1));
    expect(client.retire.mock.calls[0][0]).toMatchObject({ goalId: "g-live", reason: "We stopped measuring this" });
    expect(await screen.findByText(/Retired\. The target no longer applies/)).toBeTruthy();
  });

  it("Cancel closes the panel without a call", async () => {
    const client = draftFirst();
    const section = await openFirm(client);
    fireEvent.click(within(section).getByRole("button", { name: "Retire version 1" }));
    const form = await screen.findByRole("form", { name: "Retire a target" });
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Retire a target" })).toBeNull();
    expect(client.retire).not.toHaveBeenCalled();
  });
});

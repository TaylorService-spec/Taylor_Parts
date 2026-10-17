from ed import edit
p = "test/returnIntakeScan.test.jsx"
edit(p, [
("""const mount = (over = {}) => {
  const recordReturnIntake = over.recordReturnIntake
    ?? vi.fn().mockResolvedValue({ outcome: "recorded", returnId: "ret_1", partId: "PRT-1001", state: "AWAITING_DISPOSITION", quantity: 1 });
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake }, scanInputDeps: { now: advancingClock } }} />);
  return recordReturnIntake;
};""",
"""// EOS (Firebase exit F7a): the screen asks the server which companies and warehouses the caller may name. One company is the
// common case and is chosen for them; the multi-company cases below choose explicitly.
const ONE_COMPANY = { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }],
  warehouses: [{ warehouseId: "WH-PHX", name: "Phoenix", operatingCompanyId: "taylor" }] };
const mount = (over = {}) => {
  const recordReturnIntake = over.recordReturnIntake
    ?? vi.fn().mockResolvedValue({ outcome: "recorded", returnId: "ret_1", partId: "PRT-1001", state: "AWAITING_DISPOSITION", quantity: 1 });
  const listReturnIntakeOptions = over.listReturnIntakeOptions ?? vi.fn().mockResolvedValue(ONE_COMPANY);
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake, listReturnIntakeOptions }, scanInputDeps: { now: advancingClock } }} />);
  return recordReturnIntake;
};
/** Let the options read settle, then press Record. */
const recordIt = async () => {
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /record this return/i })); });
};"""),
])
s = open(p, encoding="utf-8", newline="").read()
old = """await act(async () => { fireEvent.click(screen.getByRole("button", { name: /record this return/i })); });"""
s = s.replace(old, "await recordIt();")
s = s.replace("""{ code: "functions/permission-denied" }""", """{ code: "permission-denied" }""").replace("""{ code: "functions/internal" }""", """{ code: "internal" }""")
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip("\r\n") + nl + nl + """// ═══════════════════════════════════════════ company and warehouse (EOS, Owner ruling F7a)

describe("which company is taking it in", () => {
  const TWO = { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }, { operatingCompanyId: "ventana", operatingCompanyKey: "VENTANA" }],
    warehouses: [{ warehouseId: "WH-PHX", name: "Phoenix", operatingCompanyId: "taylor" }, { warehouseId: "WH-TUS", name: "Tucson", operatingCompanyId: "ventana" }] };

  it("one company is chosen for them, and the request names it; no warehouse unless one is chosen", async () => {
    const record = mount();
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    await recordIt();
    expect(record.mock.calls[0][0].operatingCompanyId).toBe("taylor");
    expect(record.mock.calls[0][0]).not.toHaveProperty("warehouseId");
  });

  it("with several companies NOBODY GUESSES: Record waits for a choice, and the warehouses follow the company", async () => {
    const record = mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    scanPart();
    choose(/what condition is it in/i, "OPENED");
    expect(screen.getByRole("button", { name: /record this return/i }).disabled).toBe(true);
    expect(screen.getByText(/choose the company taking it in/i)).toBeTruthy();
    choose(/which company is taking it in/i, "ventana");
    const warehouses = [...screen.getByLabelText(/receiving warehouse/i).querySelectorAll("option")].map((o) => o.value);
    expect(warehouses).toEqual(["", "WH-TUS"]);
    choose(/receiving warehouse/i, "WH-TUS");
    await recordIt();
    expect(record.mock.calls[0][0]).toMatchObject({ operatingCompanyId: "ventana", warehouseId: "WH-TUS" });
  });

  it("no company authority is said in words, and nothing can be recorded", async () => {
    const refused = Object.assign(new Error("no"), { code: "permission-denied", details: { code: "COMPANY_AUTHORITY_REQUIRED" } });
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(refused) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/no operating company to take returns in for/i);
  });

  it("OFFLINE, the last server answer is used; a refusal is never answered from the cache", async () => {
    globalThis.localStorage.setItem("eos.returnIntake.options.v1", JSON.stringify(TWO));
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    await act(async () => {});
    expect([...screen.getByLabelText(/which company is taking it in/i).querySelectorAll("option")].map((o) => o.value))
      .toEqual(["", "taylor", "ventana"]);
    cleanup();
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" })) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not authorized/i);
    globalThis.localStorage.removeItem("eos.returnIntake.options.v1");
  });
});
""".replace("\n", nl)
open(p, "w", encoding="utf-8", newline="").write(s)

edit("test/warehouseOfflineScreens.test.jsx", [
("""  const mount = (recordReturnIntake, rt = runtime()) => {
    render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake }, scanInputDeps, offline: rt }} />);
    return rt;
  };""",
"""  // EOS (F7a): the company list is the server's answer; one company is chosen for the operator.
  const listReturnIntakeOptions = () => Promise.resolve({ companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "TAYLOR" }], warehouses: [] });
  const mount = (recordReturnIntake, rt = runtime()) => {
    render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake, listReturnIntakeOptions }, scanInputDeps, offline: rt }} />);
    return rt;
  };"""),
("""  const takeIn = async () => {
    await act(async () => {""",
"""  const takeIn = async () => {
    await act(async () => {}); // the options read settles
    await act(async () => {"""),
])

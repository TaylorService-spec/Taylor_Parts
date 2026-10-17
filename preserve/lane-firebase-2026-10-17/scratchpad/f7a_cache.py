from ed import edit
V = "D:/eos-fb-exit/field-ops-app-vite/"
edit(V + "src/App.jsx", [
("""function useScanCapabilityGate() {
  const { user } = useAuth();
  return useInventoryScanCapabilities(user);
}

/** /service/scan. A component only because renderSubnavItem cannot call hooks. */
function ScanWorkspaceSurface({ role }) {
  const { hasCapability } = useScanCapabilityGate();
  return <ScanWorkspace deps={{ hasCapability, role }} />;
}""",
"""function useScanCapabilityGate() {
  const { user } = useAuth();
  // returnDeps.cacheOwner: the signed-in identity the returns-intake offline options are kept under, so a shared device
  // never offers one user's companies and warehouses to the next (ReturnIntakeScan, F7a).
  return { ...useInventoryScanCapabilities(user), returnDeps: { cacheOwner: user?.uid ?? null } };
}

/** /service/scan. A component only because renderSubnavItem cannot call hooks. */
function ScanWorkspaceSurface({ role }) {
  const { hasCapability, returnDeps } = useScanCapabilityGate();
  return <ScanWorkspace deps={{ hasCapability, role, returnDeps }} />;
}"""),
("""  const { hasCapability } = useScanCapabilityGate();
  const deps = { hasCapability, role };""",
"""  const { hasCapability, returnDeps } = useScanCapabilityGate();
  const deps = { hasCapability, role, returnDeps };"""),
])
edit(V + "src/modules/warehouse/WarehouseShell.jsx", [
("""<ScanWorkspace deps={{ hasCapability, role: deps.role ?? role, initialWorkflow: requested }} />""",
"""<ScanWorkspace deps={{ hasCapability, role: deps.role ?? role, initialWorkflow: requested, returnDeps: deps.returnDeps }} />"""),
])
p = V + "src/modules/scan/ReturnIntakeScan.jsx"
edit(p, [
("""// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave this device are kept, and used only when the options read
// cannot reach the server (`unavailable`). That is safe because nothing is decided here: a queued intake replays through
// recordReturnIntake, which re-checks the company and the warehouse. A refusal is never answered from the cache.
const OPTIONS_CACHE_KEY = "eos.returnIntake.options.v1";
const cacheOptions = (value) => { try { globalThis.localStorage?.setItem(OPTIONS_CACHE_KEY, JSON.stringify(value)); } catch { /* best effort */ } };
const cachedOptions = () => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPTIONS_CACHE_KEY) ?? "null");
    return v && Array.isArray(v.companies) && Array.isArray(v.warehouses) ? v : null;
  } catch { return null; }
};""",
"""// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave THIS USER on this device are kept, and used only when the
// options read cannot reach the server (`unavailable`). That is safe because nothing is decided here: a queued intake
// replays through recordReturnIntake, which re-checks the company and the warehouse. A refusal is never answered from the
// cache. KEYED BY THE SIGNED-IN IDENTITY (deps.cacheOwner): a shared device never offers one user's companies and
// warehouses to the next (Lane D, #2133). With no identity, nothing is cached and nothing is read back.
const OPTIONS_CACHE_PREFIX = "eos.returnIntake.options.v2:";
const cacheOptions = (owner, value) => {
  if (!owner) return;
  try { globalThis.localStorage?.setItem(OPTIONS_CACHE_PREFIX + owner, JSON.stringify({ owner, ...value })); } catch { /* best effort */ }
};
const cachedOptions = (owner) => {
  if (!owner) return null;
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPTIONS_CACHE_PREFIX + owner) ?? "null");
    return v && v.owner === owner && Array.isArray(v.companies) && Array.isArray(v.warehouses)
      ? { companies: v.companies, warehouses: v.warehouses } : null;
  } catch { return null; }
};"""),
("""  const client = deps?.returnClient ?? returnCommandClient;""",
"""  const client = deps?.returnClient ?? returnCommandClient;
  const cacheOwner = typeof deps?.cacheOwner === "string" && deps.cacheOwner !== "" ? deps.cacheOwner : null;"""),
("""        cacheOptions(value);""", """        cacheOptions(cacheOwner, value);"""),
("""        const cached = raw === "unavailable" ? cachedOptions() : null;""", """        const cached = raw === "unavailable" ? cachedOptions(cacheOwner) : null;"""),
("""    return () => { cancelled = true; };
  }, [client]);""", """    return () => { cancelled = true; };
  }, [client, cacheOwner]);"""),
])
t = V + "test/returnIntakeScan.test.jsx"
edit(t, [
("""  const listReturnIntakeOptions = over.listReturnIntakeOptions ?? vi.fn().mockResolvedValue(ONE_COMPANY);
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake, listReturnIntakeOptions }, scanInputDeps: { now: advancingClock } }} />);""",
"""  const listReturnIntakeOptions = over.listReturnIntakeOptions ?? vi.fn().mockResolvedValue(ONE_COMPANY);
  render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake, listReturnIntakeOptions }, scanInputDeps: { now: advancingClock },
    ...(over.cacheOwner !== undefined ? { cacheOwner: over.cacheOwner } : {}) }} />);"""),
("""  it("OFFLINE, the last server answer is used; a refusal is never answered from the cache", async () => {
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
  });""",
"""  it("OFFLINE, THIS user's last server answer is used; a refusal is never answered from the cache", async () => {
    // Online once as u-1: the answer is kept under u-1.
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    cleanup();
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    await act(async () => {});
    expect([...screen.getByLabelText(/which company is taking it in/i).querySelectorAll("option")].map((o) => o.value))
      .toEqual(["", "taylor", "ventana"]);
    cleanup();
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" })) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not authorized/i);
    globalThis.localStorage.clear();
  });

  it("SHARED DEVICE: another user, or no signed-in identity, never sees a cached answer (keyed by principal)", async () => {
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    cleanup();
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    mount({ cacheOwner: "u-2", listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be recorded/i);
    expect(screen.queryByLabelText(/which company is taking it in/i)).toBeNull();
    cleanup();
    mount({ listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be recorded/i);
    // Nothing at all is kept for an anonymous caller.
    globalThis.localStorage.clear();
    mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    expect(Object.keys(globalThis.localStorage)).toEqual([]);
    globalThis.localStorage.clear();
  });"""),
])

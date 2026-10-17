from ed import edit
R = "D:/eos-fb-exit/"
# server: the options answer states WHOSE answer it is
edit(R + "functions/src/eosOps/returnIntake.ts", [
("""    const keyOf = new Map(keys.map((k) => [String(k.id), String(k.key)]));
    return Object.freeze({
      companies:""",
"""    const keyOf = new Map(keys.map((k) => [String(k.id), String(k.key)]));
    return Object.freeze({
      // Whose answer this is, as the SERVER resolved it -- the client binds any offline copy to exactly this tenant and
      // Principal (it has no tenant of its own to check). Grants nothing: every replay is re-authorized in full.
      tenantId: actor.tenantId,
      principalId: actor.principalId,
      companies:"""),
])
edit(R + "functions/test/returnIntakePostgres.test.mjs", [
("""    const options = await R.listReturnIntakeOptions(deps, clerk, {});""",
"""    const options = await R.listReturnIntakeOptions(deps, clerk, {});
    assert.deepEqual([options.tenantId, options.principalId], [T, clerk.principalId], "the answer says whose it is");"""),
])
# client
edit(R + "field-ops-app-vite/src/App.jsx", [
("""  return { ...useInventoryScanCapabilities(user), returnDeps: { cacheOwner: user?.uid ?? null } };""",
"""  // The STABLE identity: its source (EOS session or Firebase) and its subject, never a display value.
  const cacheOwner = user?.uid ? `${user.identitySource ?? "firebase"}:${user.uid}` : null;
  return { ...useInventoryScanCapabilities(user), returnDeps: { cacheOwner } };"""),
])
p = R + "field-ops-app-vite/src/modules/scan/ReturnIntakeScan.jsx"
edit(p, [
("""// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave THIS USER on this device are kept, and used only when the
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
};""",
"""// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave THIS USER on this device are kept, and used only when the
// options read cannot reach the server (`unavailable`). It never bypasses authorization: nothing is decided here, and a
// queued intake replays through recordReturnIntake, which re-checks the capability, the company and the warehouse. A
// refusal is never answered from the cache.
//
// ISOLATION (Lane D / Owner, #2133): the entry is keyed by the STABLE signed-in identity (deps.cacheOwner = identity source
// + subject) and carries the tenant and Principal the SERVER resolved for that answer; it is used only when its owner
// matches and both are recorded. With no identity nothing is cached or read. Older shared entries (v1, keyed by nothing;
// v2, keyed by subject alone) are deleted on sight and never read.
const OPTIONS_CACHE_PREFIX = "eos.returnIntake.options.v3:";
const RETIRED_CACHE_KEYS = (storage) => Object.keys(storage).filter((k) => k === "eos.returnIntake.options.v1" || k.startsWith("eos.returnIntake.options.v2:"));
const forgetRetiredCaches = () => {
  try { const s = globalThis.localStorage; if (s) for (const k of RETIRED_CACHE_KEYS(s)) s.removeItem(k); } catch { /* best effort */ }
};
const cacheOptions = (owner, value) => {
  if (!owner || typeof value.tenantId !== "string" || typeof value.principalId !== "string") return;
  try {
    globalThis.localStorage?.setItem(OPTIONS_CACHE_PREFIX + owner, JSON.stringify({
      owner, tenantId: value.tenantId, principalId: value.principalId, companies: value.companies, warehouses: value.warehouses,
    }));
  } catch { /* best effort */ }
};
const cachedOptions = (owner) => {
  if (!owner) return null;
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPTIONS_CACHE_PREFIX + owner) ?? "null");
    return v && v.owner === owner && typeof v.tenantId === "string" && typeof v.principalId === "string"
      && Array.isArray(v.companies) && Array.isArray(v.warehouses)
      ? { companies: v.companies, warehouses: v.warehouses } : null;
  } catch { return null; }
};"""),
("""      .then((r) => {
        const value = { companies: Array.isArray(r?.companies) ? r.companies : [], warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [] };
        cacheOptions(cacheOwner, value);
        return value;
      })""",
"""      .then((r) => {
        const value = { companies: Array.isArray(r?.companies) ? r.companies : [], warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [] };
        cacheOptions(cacheOwner, { ...value, tenantId: r?.tenantId, principalId: r?.principalId });
        return value;
      })"""),
("""  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => client.listReturnIntakeOptions())""",
"""  useEffect(() => {
    let cancelled = false;
    forgetRetiredCaches();
    Promise.resolve()
      .then(() => client.listReturnIntakeOptions())"""),
])
t = R + "field-ops-app-vite/test/returnIntakeScan.test.jsx"
edit(t, [
("""  const TWO = { companies: [""", """  const TWO = { tenantId: "t-taylor", principalId: "prn-1", companies: ["""),
("""    // Online once as u-1: the answer is kept under u-1.
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });""",
"""    // Online once as u-1: the answer is kept under u-1, with the tenant and Principal the server stated.
    mount({ cacheOwner: "u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });"""),
("""    // Nothing at all is kept for an anonymous caller.
    globalThis.localStorage.clear();
    mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    expect(Object.keys(globalThis.localStorage)).toEqual([]);
    globalThis.localStorage.clear();
  });""",
"""    // Nothing at all is kept for an anonymous caller.
    globalThis.localStorage.clear();
    mount({ listReturnIntakeOptions: vi.fn().mockResolvedValue(TWO) });
    await act(async () => {});
    expect(Object.keys(globalThis.localStorage)).toEqual([]);
    globalThis.localStorage.clear();
  });

  it("an answer that does not say whose it is (no tenant / Principal) is never cached; old shared entries are deleted, never read", async () => {
    const offline = Object.assign(new Error("offline"), { code: "unavailable" });
    const { tenantId, principalId, ...anonymous } = TWO;
    expect([tenantId, principalId]).toEqual(["t-taylor", "prn-1"]);
    mount({ cacheOwner: "eos:u-1", listReturnIntakeOptions: vi.fn().mockResolvedValue(anonymous) });
    await act(async () => {});
    expect(Object.keys(globalThis.localStorage)).toEqual([]);
    cleanup();
    globalThis.localStorage.setItem("eos.returnIntake.options.v1", JSON.stringify(TWO));
    globalThis.localStorage.setItem("eos.returnIntake.options.v2:eos:u-1", JSON.stringify({ owner: "eos:u-1", ...TWO }));
    mount({ cacheOwner: "eos:u-1", listReturnIntakeOptions: vi.fn().mockRejectedValue(offline) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be recorded/i);
    expect(Object.keys(globalThis.localStorage)).toEqual([], "retired entries are removed on sight");
    globalThis.localStorage.clear();
  });"""),
])

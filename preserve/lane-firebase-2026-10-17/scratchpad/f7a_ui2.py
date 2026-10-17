from ed import edit
p = "src/modules/scan/ReturnIntakeScan.jsx"
edit(p, [
("""/** The refusal, in words. `details.code` is the server's own (EosOperationError). */""",
"""// OFFLINE INTAKE KEEPS WORKING. The last options the SERVER gave this device are kept, and used only when the options read
// cannot reach the server (`unavailable`). That is safe because nothing is decided here: a queued intake replays through
// recordReturnIntake, which re-checks the company and the warehouse. A refusal is never answered from the cache.
const OPTIONS_CACHE_KEY = "eos.returnIntake.options.v1";
const cacheOptions = (value) => { try { globalThis.localStorage?.setItem(OPTIONS_CACHE_KEY, JSON.stringify(value)); } catch { /* best effort */ } };
const cachedOptions = () => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPTIONS_CACHE_KEY) ?? "null");
    return v && Array.isArray(v.companies) && Array.isArray(v.warehouses) ? v : null;
  } catch { return null; }
};

/** The refusal, in words. `details.code` is the server's own (EosOperationError). */"""),
("""      .then((r) => {
        if (cancelled) return;
        const companies = Array.isArray(r?.companies) ? r.companies : [];
        setOptions({ state: "ready", companies, warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [], error: null });
        if (companies.length === 1) setCompanyId(companies[0].operatingCompanyId);
      })
      .catch((err) => {
        if (cancelled) return;
        const raw = typeof err?.code === "string" ? err.code : "";
        setOptions({ state: "failed", companies: [], warehouses: [], error: refusalText(raw || "internal", err?.details?.code) });
      });""",
"""      .then((r) => {
        const value = { companies: Array.isArray(r?.companies) ? r.companies : [], warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [] };
        cacheOptions(value);
        return value;
      })
      .catch((err) => {
        const raw = typeof err?.code === "string" ? err.code : "";
        const cached = raw === "unavailable" ? cachedOptions() : null;
        if (cached) return cached;
        throw err;
      })
      .then((value) => {
        if (cancelled) return;
        setOptions({ state: "ready", ...value, error: null });
        if (value.companies.length === 1) setCompanyId(value.companies[0].operatingCompanyId);
      })
      .catch((err) => {
        if (cancelled) return;
        const raw = typeof err?.code === "string" ? err.code : "";
        setOptions({ state: "failed", companies: [], warehouses: [], error: refusalText(raw || "internal", err?.details?.code) });
      });"""),
])

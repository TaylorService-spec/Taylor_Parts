from ed import edit
p = "src/modules/scan/ReturnIntakeScan.jsx"
edit(p, [
("""// ============================ IT WRITES NOTHING ELSE ============================
//
// One governed command, one document. No ledger event, no balance, no serialized-asset state change.
// A returned serialized unit does not become AVAILABLE here.""",
"""// ============================ IT WRITES NOTHING ELSE ============================
//
// One governed command, one record. No ledger event, no balance, no serialized-asset state change.
// A returned serialized unit does not become AVAILABLE here.
//
// ============================ ON EOS CORE (Firebase exit F7a, DECISIONS #242) ============================
//
// The command is EOS's recordReturnIntake (POST /operations/inventory). By Owner ruling a return names its OPERATING
// COMPANY (required) and may name its receiving WAREHOUSE. The choices offered are the server's own answer
// (listReturnIntakeOptions: the caller's companies, and the warehouses in reach for each); with one company it is chosen
// for them, with several nobody guesses. The server re-checks both on every call."""),
("""const newKey = () => `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;""",
"""const newKey = () => `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** The refusal, in words. `details.code` is the server's own (EosOperationError). */
function refusalText(code, detailCode) {
  if (code === "permission-denied") {
    return detailCode === "COMPANY_AUTHORITY_REQUIRED"
      ? "You have no operating company to take returns in for. Ask an administrator."
      : "You are not authorized to take returns in. That authority has not been granted, or is not switched on here.";
  }
  if (code === "invalid-argument") {
    return detailCode === "OPERATING_COMPANY_NOT_GOVERNED"
      ? "That company is not one you can take returns in for."
      : "That return could not be accepted — check the part and the condition.";
  }
  if (code === "not-found") return "That receiving warehouse is not available for that company.";
  return "That return could not be recorded. Nothing was changed.";
}"""),
("""  const [partId, setPartId] = useState(null);""",
"""  // The server's answer to "which company, which warehouse" -- never a list made up here.
  const [options, setOptions] = useState({ state: "loading", companies: [], warehouses: [], error: null });
  const [companyId, setCompanyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [partId, setPartId] = useState(null);"""),
("""  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
""",
"""  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => client.listReturnIntakeOptions())
      .then((r) => {
        if (cancelled) return;
        const companies = Array.isArray(r?.companies) ? r.companies : [];
        setOptions({ state: "ready", companies, warehouses: Array.isArray(r?.warehouses) ? r.warehouses : [], error: null });
        if (companies.length === 1) setCompanyId(companies[0].operatingCompanyId);
      })
      .catch((err) => {
        if (cancelled) return;
        const raw = typeof err?.code === "string" ? err.code : "";
        setOptions({ state: "failed", companies: [], warehouses: [], error: refusalText(raw || "internal", err?.details?.code) });
      });
    return () => { cancelled = true; };
  }, [client]);
"""),
("""  const submit = useCallback(async () => {
    if (!partId || condition === "" || busy) return;
    setBusy(true);
    setError(null);
    const request = {
      partId,""",
"""  const submit = useCallback(async () => {
    if (!partId || condition === "" || companyId === "" || busy) return;
    setBusy(true);
    setError(null);
    const request = {
      operatingCompanyId: companyId,
      ...(warehouseId ? { warehouseId } : {}),
      partId,"""),
("""        const raw = typeof submitted?.error?.code === "string" ? submitted.error.code : "";
        const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
        setError(
          code === "permission-denied"
            ? "You are not authorized to take returns in. That authority has not been granted, or is not switched on here."
            : code === "invalid-argument"
              ? "That return could not be accepted — check the part and the condition."
              : "That return could not be recorded. Nothing was changed.",
        );
      }
    } catch (err) {
      if (!alive.current) return;
      const raw = typeof err?.code === "string" ? err.code : "";
      const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
      setError(
        code === "permission-denied"
          ? "You are not authorized to take returns in. That authority has not been granted, or is not switched on here."
          : code === "invalid-argument"
            ? "That return could not be accepted — check the part and the condition."
            : "That return could not be recorded. Nothing was changed.",
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [partId, condition, busy, client, source, sourceReference, reason, quantity]);""",
"""        const raw = typeof submitted?.error?.code === "string" ? submitted.error.code : "";
        setError(refusalText(raw || "internal", submitted?.error?.details?.code));
      }
    } catch (err) {
      if (!alive.current) return;
      const raw = typeof err?.code === "string" ? err.code : "";
      setError(refusalText(raw || "internal", err?.details?.code));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [partId, condition, companyId, warehouseId, busy, client, source, sourceReference, reason, quantity]);"""),
("""      <p className="fo-scan__plan">
        This records what came back. It does not decide what happens to it, and it does not put
        anything back into sellable stock.
      </p>
""",
"""      <p className="fo-scan__plan">
        This records what came back. It does not decide what happens to it, and it does not put
        anything back into sellable stock.
      </p>

      {options.state === "loading" && <p className="fo-muted" role="status">Loading your companies…</p>}
      {options.state === "failed" && <p className="fo-scan__notice fo-scan__notice--warn" role="alert">{options.error}</p>}
      {options.state === "ready" && (
        <>
          <label className="fo-returns__field">
            <span>Which company is taking it in?</span>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setWarehouseId(""); }} aria-label="Which company is taking it in">
              {options.companies.length !== 1 && <option value="">Choose…</option>}
              {options.companies.map((c) => (
                <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{c.operatingCompanyKey ?? c.operatingCompanyId}</option>
              ))}
            </select>
          </label>
          <label className="fo-returns__field">
            <span>Receiving warehouse <span className="fo-muted">(Optional)</span></span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Receiving warehouse" disabled={companyId === ""}>
              <option value="">Not stated</option>
              {options.warehouses.filter((w) => w.operatingCompanyId === companyId).map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>
              ))}
            </select>
          </label>
        </>
      )}
"""),
("""          <Button type="button" variant="primary" className="fo-returns__submit" onClick={submit} disabled={condition === "" || busy}>""",
"""          <Button type="button" variant="primary" className="fo-returns__submit" onClick={submit} disabled={condition === "" || companyId === "" || busy}>"""),
("""          {condition === "" && (
            <p className="fo-scan__reason">Choose a condition before recording. It is an observation, so nobody can choose it for you.</p>
          )}""",
"""          {condition === "" && (
            <p className="fo-scan__reason">Choose a condition before recording. It is an observation, so nobody can choose it for you.</p>
          )}
          {condition !== "" && companyId === "" && options.state === "ready" && (
            <p className="fo-scan__reason">Choose the company taking it in before recording.</p>
          )}"""),
])

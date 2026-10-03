// Administration -> Sales Configuration -> Employee Sales Authority (Owner ruling #204, 2026-10-03).
//
// Each Sales user's MAXIMUM CUSTOMER DISCOUNT. It governs only the customer-facing transaction discount -- never internal
// pricing, cost, trade-in value or a resale price. Three states, each said in words: not configured (no discount can be
// applied), no discount authority (0%), or up to a stated percentage. Every read and change goes to /admin/policy, gated on
// sales.discountAuthority.manage and audited with the affected user, the previous and new limit, the actor and the reason.
// The screen decides nothing; the Sales commands enforce the limit on the server.
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "Sales Configuration is not available to you. It needs sales.discountAuthority.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

/** "12.5" -> 1250 basis points; null when it is not a percentage from 0 to 100 with at most two decimals. */
export function percentToBasisPoints(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

const authorityWords = (item) => item.state === "NOT_CONFIGURED" ? "Not configured — no discount can be applied"
  : item.maxDiscountBasisPoints === 0 ? "No discount authority (0%)"
    : `Up to ${(item.maxDiscountBasisPoints / 100).toFixed(2)}%`;

export default function AdminSalesConfiguration({ callApi = callPolicyApi }) {
  const [items, setItems] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const res = await callApi("listSalesDiscountAuthorities", {});
    if (!res.ok) { setItems(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setItems(res.data?.items ?? []);
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  const save = async (principalId) => {
    const bp = percentToBasisPoints(drafts[principalId]);
    if (bp === null) { setNotice({ tone: "danger", text: "A maximum discount is a percentage from 0 to 100, like 10 or 12.5." }); return; }
    setBusy(true);
    setNotice(null);
    const res = await callApi("setSalesDiscountAuthority", { principalId, maxDiscountBasisPoints: bp, reason });
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: refusalText(res) }); return; }
    setNotice({ tone: "positive", text: "Saved." });
    setReason("");
    setDrafts((d) => ({ ...d, [principalId]: "" }));
    await load();
  };

  return (
    <div>
      <PageHeader title="Sales Configuration" subtitle="Employee Sales Authority: the most each person may discount a customer transaction. It never changes prices, costs or trade-in values." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {items && (
        <section className="fo-panel" aria-labelledby="employee-sales-authority">
          <SectionHeader id="employee-sales-authority" title="Maximum customer discount" description="Applies to percentage and fixed-amount discounts alike: a fixed amount is measured against the selling price. Each change states a reason and is audited." />
          <table className="fo-table" aria-label="Maximum customer discount">
            <thead><tr><th>Person</th><th>Maximum customer discount</th><th>Change to (%)</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.principalId}>
                  <td>{i.displayName ?? i.principalId}</td>
                  <td>{authorityWords(i)}</td>
                  <td>
                    <input className="fo-input" inputMode="decimal" aria-label={`Maximum discount percent for ${i.displayName ?? i.principalId}`}
                      value={drafts[i.principalId] ?? ""} onChange={(e) => setDrafts({ ...drafts, [i.principalId]: e.target.value })} />
                    <Button size="sm" variant="secondary" disabled={busy || !reason.trim() || !String(drafts[i.principalId] ?? "").trim()}
                      onClick={() => save(i.principalId)}>Save for {i.displayName ?? i.principalId}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Reason (required for every change)"><input className="fo-input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </section>
      )}
    </div>
  );
}

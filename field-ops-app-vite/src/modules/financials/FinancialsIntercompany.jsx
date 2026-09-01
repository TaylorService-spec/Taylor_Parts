// INTERCOMPANY — /financials/intercompany (North Star P1, page 17).
//
// Design authority: docs/north-star/financials/North Star - Financials 17 Intercompany.dc.html.
// Classified Taylor/Ventana cross-company operational activity: classification, never
// elimination. Directions derive from governed custody/charge facts — never warehouse
// names or routes. Unclassified rows are the loud exception, excluded from splits. No GL
// eliminations are drawn or implied; those belong to the external accounting authority.
//
// Current-main truth: custody facts exist (Parts/Receiving); FIN-009 allocation arithmetic
// and company summarization are merged and dormant; the CLASSIFICATION SCHEMA is not built
// and intercompany treatment is an open Owner decision (FIN-BLOCK-004 — the prepared
// decision package found NO current flow qualifying as a true intercompany event). The
// Classify action is a conceptual capability (FIN-009); who may classify is FIN-PQ-17a.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";

const DIRECTION_OPTIONS = [
  { key: "all", label: "All directions" },
  { key: "taylorToVentana", label: "Taylor → Ventana" },
  { key: "ventanaToTaylor", label: "Ventana → Taylor" },
  { key: "unclassified", label: "Unclassified" },
];

export default function FinancialsIntercompany() {
  const [direction, setDirection] = useState("all");

  return (
    <FinancialsPageFrame
      title="Intercompany"
      crumb="Intercompany"
      custody="Cross-company operational activity, classified — never eliminated. Five facts stay separate: physical ownership, supplier relationship, charge, classification, reporting treatment."
      custodyTip="Directions derive from governed custody and charge facts, never from warehouse names or routes. Unclassified activity is the loud exception and is excluded from company splits until classified. GL eliminations are never drawn or implied — they belong to the future external accounting authority. Consolidated figures elsewhere stay UNELIMINATED_SUM."
    >
      <FilterBar variant="chips" label="Direction" options={DIRECTION_OPTIONS} activeKey={direction} onChange={setDirection} />

      <FinancialsHonestSection
        id="fin-intercompany"
        title="Cross-company events"
        meta="classification is a governed, audited act · unclassified excluded from splits"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "The FIN-009 classification schema is not built: intercompany treatment is an open Owner decision (FIN-BLOCK-004), whose prepared assessment found no current Taylor↔Ventana flow qualifying as a true intercompany event. Custody facts exist; nothing here fabricates a classification over them.",
        }}
        subject="Intercompany reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Classified cross-company operational events</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Direction</th>
                <th scope="col">Inventory owner</th>
                <th scope="col">Charge bears on</th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col">
                  Classification
                  <FinAnnotation tip="Classification is an appended governed event, audited, never an in-place edit. Who may classify is an open product question (FIN-PQ-17a); the capability is conceptual until FIN-009 governance exists." />
                </th>
                <th scope="col">Reporting treatment</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}

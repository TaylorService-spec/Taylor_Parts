import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeader, StatusIndicator, CompactMetric, Button } from "../../shared/ui/primitives";
import BinBarcode from "../../shared/ui/BinBarcode";
import { downloadCsvFile } from "../../services/downloadFile";
import {
  buildBinLabels,
  labelsToCsv,
  binLabelCsvFilename,
} from "../../domain/binLabel";

// ADMINISTRATION > WAREHOUSE RACKING > LABELS & EXPORT.
//
// The physical output of the BIN programme: the thing that actually goes on the rack.
//
// It lives INSIDE the existing Warehouse Racking surface and reads the SAME governed bin list that
// screen already loaded. No second route, no second nav entry, no second location catalog, no extra
// backend call -- listBins already returns every field a label needs.
//
// ============================ ONE PROJECTION, TWO SINKS ============================
//
// The preview and the CSV are built from the SAME buildBinLabels result. A separate export model is
// exactly how a preview and a file start disagreeing about what was on the shelf.
//
// ============================ WHAT IT REFUSES TO CLAIM ============================
//
// EOS has no idea what is physically stuck to a shelf. There is no labelVersion, no lastPrintedCode,
// no printedAt -- so this surface may say "reprint after a code change", and may never say "all
// labels are current". The barcode itself survives a rename (it encodes binId), so a rename makes the
// PRINTED CODE stale and nothing else.

const MASS_PRINT_GATE =
  "Before printing the whole warehouse, Taylor still needs to confirm the code width, the barcode "
  + "type and the label stock. These previews and exports are safe to use meanwhile.";

export default function BinLabelsAndExport({ bins, warehouse, labelRequest, download = downloadCsvFile }) {
  const [selected, setSelected] = useState(() => new Set());
  const [includeInactive, setIncludeInactive] = useState(false);

  // ACTIVE by default. Nobody wants a wall of labels for shelves that are out of service, and a label
  // that looks operational for a retired location is worse than no label.
  const available = useMemo(
    () => buildBinLabels(bins ?? [], { warehouse, includeInactive }),
    [bins, warehouse, includeInactive],
  );

  const chosen = useMemo(
    () => available.filter((l) => selected.has(l.binId)),
    [available, selected],
  );

  // A row Label action asks for exactly one bin. Keyed by request rather than by binId so asking
  // twice for the SAME bin still re-selects it after the operator has changed the selection.
  useEffect(() => {
    if (labelRequest?.binId) setSelected(new Set([labelRequest.binId]));
  }, [labelRequest]);

  const toggle = useCallback((binId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(binId)) next.delete(binId); else next.add(binId);
      return next;
    });
  }, []);

  // "All visible" means exactly what is on screen under the current inactive setting -- what the
  // operator can see is what it selects.
  const selectAllVisible = useCallback(() => {
    setSelected(new Set(available.map((l) => l.binId)));
  }, [available]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const onExport = useCallback(() => {
    if (chosen.length === 0) return;
    download(binLabelCsvFilename(warehouse?.id), labelsToCsv(chosen));
  }, [chosen, warehouse, download]);

  // Browser-native print. No printer bridge, no print server, no OS dependency. The print stylesheet
  // (index.css, @media print) hides everything except .fo-labelsheet.
  const onPrint = useCallback(() => {
    if (chosen.length === 0) return;
    window.print();
  }, [chosen]);

  return (
    <>
      <SectionHeader
        title="Labels & Export"
        description="Print shelf labels for these bins, or export them for external label software. A label identifies a place; it says nothing about what is in it."
        actions={<CompactMetric value={chosen.length} label="Selected" />}
      />

      <p className="fo-wizard-hint">{MASS_PRINT_GATE}</p>

      <div className="fo-labels__controls">
        <Button variant="tertiary" onClick={selectAllVisible} disabled={available.length === 0}>
          Select all shown
        </Button>
        <Button variant="tertiary" onClick={clearSelection} disabled={chosen.length === 0}>
          Clear selection
        </Button>
        <label className="fo-labels__toggle">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              // A bin that just left the visible set must not stay silently selected.
              if (!e.target.checked) clearSelection();
            }}
          />
          Include bins that are out of use
        </label>
      </div>

      {available.length === 0 ? (
        <StatusIndicator tone="info">
          There are no bins to label in this warehouse yet.
        </StatusIndicator>
      ) : (
        <ul className="fo-labels__picker">
          {available.map((label) => (
            <li key={label.binId}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(label.binId)}
                  onChange={() => toggle(label.binId)}
                />
                <span className="fo-tabular-nums">{label.canonicalCode}</span>
                <span className="fo-muted">{label.area}</span>
                {label.status !== "ACTIVE" && (
                  <StatusIndicator tone="neutral">Out of use</StatusIndicator>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="fo-labels__actions">
        <Button onClick={onPrint} disabled={chosen.length === 0}>
          {chosen.length === 0 ? "Select labels to print" : `Print ${chosen.length} label${chosen.length === 1 ? "" : "s"}`}
        </Button>
        <Button variant="secondary" onClick={onExport} disabled={chosen.length === 0}>
          Export CSV
        </Button>
      </div>

      {chosen.length === 0 ? (
        // No file is produced that pretends to contain labels.
        <StatusIndicator tone="neutral">
          Nothing is selected, so there is nothing to print or export yet.
        </StatusIndicator>
      ) : (
        <>
          <SectionHeader
            level={3}
            title="Preview"
            description="Exactly what will print. The barcode holds the bin's permanent identity, so it keeps working even if the printed code is changed later."
          />
          {/* The ONLY thing @media print keeps. */}
          <div className="fo-labelsheet">
            {chosen.map((label) => (
              <article
                key={label.binId}
                className="fo-labelsheet__label"
                aria-label={`Label for ${label.canonicalCode}${label.area ? `, area ${label.area}` : ""}`}
              >
                <BinBarcode
                  payload={label.machineToken}
                  ariaLabel={`Barcode encoding location ${label.canonicalCode}`}
                />
                {/* Visually dominant: a person reads this from three metres away. */}
                <p className="fo-labelsheet__code fo-tabular-nums">{label.canonicalCode}</p>
                <p className="fo-labelsheet__context">
                  {[label.warehouseName, label.area].filter(Boolean).join(" · ")}
                </p>
                {label.status !== "ACTIVE" && (
                  <p className="fo-labelsheet__retired">OUT OF USE</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}

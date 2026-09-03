import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";

// BIN BARCODE — the machine-readable half of a location label.
//
// ============================ SYMBOLOGY IS NOT IDENTITY ============================
//
// The payload is fixed by domain/binLabel.js's `toBinScanToken`. Code 128 is only how those
// characters are DRAWN. Swapping the renderer later -- when the client answers C-4 -- changes no
// binId, no scan token and no already-printed label's meaning. That separation is why the symbology
// question is a rollout gate rather than an architecture decision.
//
// Code 128 for v1 because it carries the required alphanumeric payload, essentially every dedicated
// scanner reads it, and it is dense enough for a shelf-edge label.
//
// ============================ SVG, NOT CANVAS ============================
//
// Vector output survives being scaled to a label size nobody has chosen yet (C-5 is open). A raster
// barcode scaled up softens its bar edges, and a soft edge is a barcode a scanner refuses at an
// angle in bad warehouse light.
//
// ============================ FAIL VISIBLY ============================
//
// A render failure shows an explicit error IN PLACE OF the barcode and never takes down the
// Administration page around it. A label silently missing its barcode is the worst outcome available:
// someone sticks it on a shelf and discovers the problem months later with a scanner in their hand.
//
// LOCAL ONLY. JsBarcode draws into the SVG element we hand it. No network request, no remote image
// service, no external URL.

export const BIN_BARCODE_SYMBOLOGY = "CODE128";

export default function BinBarcode({ payload, height = 48, className = "", ariaLabel }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setFailed(false);
    try {
      JsBarcode(node, payload, {
        format: BIN_BARCODE_SYMBOLOGY,
        height,
        // The human code is rendered as real text by the label itself, at a size a person can read
        // across a warehouse. The renderer's own tiny caption would just be a second, smaller copy.
        displayValue: false,
        margin: 8, // the quiet zone. Without it a scanner cannot find the start of the symbol.
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      // Leave the element empty and say so, rather than rendering a half-drawn symbol.
      node.replaceChildren();
      setFailed(true);
    }
  }, [payload, height]);

  if (failed) {
    return (
      <p className={`fo-binbarcode__error ${className}`.trim()} role="status">
        This barcode could not be generated. Do not use this label.
      </p>
    );
  }

  return (
    <svg
      ref={ref}
      className={`fo-binbarcode ${className}`.trim()}
      role="img"
      // The code is always available as text too -- the bars are never the only representation.
      aria-label={ariaLabel ?? `Barcode for ${payload}`}
    />
  );
}

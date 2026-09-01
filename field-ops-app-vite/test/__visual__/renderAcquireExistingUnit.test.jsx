// VISUAL HARNESS — renders the real Add existing unit dialog to a static file, so its composition can
// be LOOKED AT rather than only asserted about.
//
// This surface was reported for things a passing test suite would happily have missed: three fields
// compressed onto one line, a run-on reason row, a dense read-back. Assertions can hold a class name
// in place; only a rendered page shows whether the result reads as a governed transaction.
//
// Companion to acquireExistingUnitComposition.test.jsx, which proves the behaviour. Both stages are
// written out, plus the failed-location state, because that state is the one the invariant is about.
//
// Skipped unless VISUAL=1.
import { describe, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/hooks/useSerialTrackedParts", async (orig) => {
  const actual = await orig();
  return { ...actual, useSerialTrackedParts: vi.fn() };
});

import { SERIAL_PARTS_STATUS } from "../../src/hooks/useSerialTrackedParts";
import { RECEIVING_OUTCOME } from "../../src/domain/receivingTransport.js";
import AcquireExistingUnit from "../../src/modules/receiving/AcquireExistingUnit.jsx";

const PARTS = {
  status: SERIAL_PARTS_STATUS.READY,
  options: [
    { value: "part_c712", label: "Taylor C712 — Soft Serve Freezer" },
    { value: "part_c723", label: "Taylor C723 — Twin Twist" },
  ],
};
const LOCATIONS = [
  { value: "wh_main", label: "Main Distribution Center" },
  { value: "wh_south", label: "South Depot" },
];

function page(title, html) {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<body class="fo-app" style="padding:24px;background:var(--color-surface-page)">${html}</body>`;
}

const write = (name, html) =>
  fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", name), html);

describe.skipIf(!process.env.VISUAL)("visual harness — Add existing unit", () => {
  it("writes the form stage, the confirm stage and the failed-location state", () => {
    const mount = (status, options) => render(
      <AcquireExistingUnit
        canAcquire
        locationOptions={options}
        locationsStatus={status}
        onClose={() => {}}
        onAcquired={() => {}}
        onRetryLocations={() => {}}
        deps={{ useParts: () => PARTS, callAcquire: async () => ({}) }}
      />,
    );

    const ready = mount(RECEIVING_OUTCOME.READY, LOCATIONS);
    write("acquire-form.rendered.html", page("Add existing unit — form", document.body.innerHTML));

    fireEvent.change(screen.getByLabelText("Part"), { target: { value: "part_c712" } });
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "GATE-ND33-DO-NOT-DELETE" } });
    fireEvent.change(screen.getByLabelText("Company location"), { target: { value: "wh_main" } });
    fireEvent.click(screen.getByRole("radio", { name: /Opening balance/ }));
    write("acquire-form-complete.rendered.html", page("Add existing unit — complete", document.body.innerHTML));

    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    write("acquire-confirm.rendered.html", page("Confirm acquisition", document.body.innerHTML));

    ready.unmount();
    // The state the invariant is about: no location may be shown as chosen beside this message.
    mount(RECEIVING_OUTCOME.UNAVAILABLE, LOCATIONS);
    write("acquire-location-error.rendered.html", page("Add existing unit — location unreadable", document.body.innerHTML));
  });
});

// Administration Overview -- "Version / deployment info" section (vitest + jsdom + RTL).
//
// Compares the running bundle's build id (`__APP_COMMIT__`, stubbed as "test" by
// vitest.config.js) against the deployed manifest fetched from `/version.json` at
// mount (see vite.config.js emitVersionManifest / src/domain/deploymentVersionInfo.js).
// Covers: a normal manifest render, a commit mismatch surfacing the "behind" notice,
// and a failed fetch degrading to the honest "unavailable" state -- never a throw.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdministrationOverview from "../src/modules/administration/AdministrationOverview.jsx";

afterEach(cleanup);

// vitest.config.js defines __APP_COMMIT__ as "test" for this test env -- matching
// manifest fixtures below must use the SAME value to exercise the "match" path.
const RUNNING_COMMIT = "test";

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function renderOverview(fetchImpl) {
  return render(
    <MemoryRouter>
      <AdministrationOverview fetchImpl={fetchImpl} />
    </MemoryRouter>,
  );
}

describe("AdministrationOverview -- Version / deployment info section", () => {
  it("renders the deployed commit, buildTime, and environment from a matching manifest", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        commit: RUNNING_COMMIT,
        base: "/",
        buildTime: "2026-08-10T12:00:00.000Z",
        environmentId: "taylor-parts-sandbox",
        environmentRole: "sandbox",
        schema: 2,
      }),
    );
    renderOverview(fetchImpl);

    await waitFor(() => expect(screen.getByTestId("version-status-match")).toBeTruthy());

    const section = screen.getByTestId("version-deployment-info");
    expect(section.textContent).toContain(RUNNING_COMMIT);
    expect(section.textContent).toContain("taylor-parts-sandbox");
    expect(section.textContent).toContain("sandbox");
    // buildTime is rendered through formatTimestamp -- not the raw ISO string.
    expect(section.textContent).not.toContain("2026-08-10T12:00:00.000Z");
    expect(fetchImpl).toHaveBeenCalledWith("/version.json", expect.objectContaining({ cache: "no-store" }));
  });

  it("shows the 'behind' notice when the deployed commit differs from the running bundle's", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        commit: "deadbeef",
        buildTime: "2026-08-10T12:00:00.000Z",
        environmentId: "taylor-parts-sandbox",
        environmentRole: "sandbox",
        schema: 2,
      }),
    );
    renderOverview(fetchImpl);

    await waitFor(() => expect(screen.getByTestId("version-status-behind")).toBeTruthy());
    expect(screen.getByTestId("version-status-behind").textContent).toMatch(/behind the deployed version/i);
    expect(screen.queryByTestId("version-status-match")).toBeNull();
  });

  it("renders the honest 'unavailable' state on fetch failure, without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    renderOverview(fetchImpl);

    await waitFor(() => expect(screen.getByTestId("version-manifest-unavailable")).toBeTruthy());
    expect(screen.getByTestId("version-manifest-unavailable").textContent).toMatch(/unavailable/i);
    expect(screen.queryByTestId("version-status-behind")).toBeNull();
    expect(screen.queryByTestId("version-status-match")).toBeNull();
  });

  it("renders the honest 'unavailable' state when the manifest is absent (non-OK response)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    renderOverview(fetchImpl);

    await waitFor(() => expect(screen.getByTestId("version-manifest-unavailable")).toBeTruthy());
  });
});

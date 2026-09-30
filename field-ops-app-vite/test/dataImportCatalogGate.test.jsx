// Data Import under an ACTIVE PostgreSQL catalog (injected below): the client refuses to offer or execute an import whose
// execution on the deployed (pre-freeze) Firebase runtime would write a Catalog collection (PARTS) or treat
// the frozen Firestore catalog as current (INVENTORY). The refusal happens BEFORE the executeDataImport
// callable is ever invoked; entity types that reach no Catalog collection are unaffected.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const H = vi.hoisted(() => ({ calls: [], stageJob: null }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions, name) => async (payload) => {
    H.calls.push([name, payload]);
    if (name === "listDataImportJobs") return { data: { jobs: [] } };
    if (name === "stageDataImport") return { data: { staged: true, job: H.stageJob } };
    if (name === "executeDataImport") return { data: { job: { ...H.stageJob, result: { created: 1, replayed: 0, failed: 0, rows: [] } } } };
    return { data: null };
  },
}));
vi.mock("../src/firebase/firebase", () => ({ functions: {} }));
// The committed CATALOG_AUTHORITY_POSTGRES_ACTIVE stays false until the activation flip; this suite proves the ACTIVE
// behaviour by INJECTING it at the config seam (the constant and the refusal predicate's default), never by requiring
// the committed constant to be flipped. The committed (dormant) behaviour is pinned in catalogAuthorityClientGate and
// dataImportView.
vi.mock("../src/config/catalogAuthority.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CATALOG_AUTHORITY_POSTGRES_ACTIVE: true,
    importRefusedByCatalogAuthority: (entityType, postgresActive = true) => actual.importRefusedByCatalogAuthority(entityType, postgresActive),
  };
});

import { executeDataImport, catalogImportRefusal } from "../src/access/dataImportClient.js";
import AdminDataImport from "../src/modules/administration/AdminDataImport.jsx";

afterEach(() => {
  cleanup();
  H.calls.length = 0;
});

const job = (entityType) => ({
  jobId: "IMP-1", entityType, fileName: "f.csv", mapping: { A: "a" },
  summary: { total: 1, ready: 1, warnings: 0, errors: 0 },
  rows: [{ sourceRowNumber: 2, identity: "X-1", classification: "READY", findings: [] }],
});

describe("executeDataImport -- refused client-side before any callable", () => {
  it.each(["PARTS", "INVENTORY"])("%s is refused with CATALOG_AUTHORITY_MOVED and no call", async (entityType) => {
    const res = await executeDataImport("IMP-1", entityType);
    expect(res).toMatchObject({ ok: false, code: "CATALOG_AUTHORITY_MOVED" });
    expect(res.message).toMatch(/PostgreSQL/);
    expect(H.calls).toEqual([]);
  });

  it.each([undefined, null, "SOMETHING_NEW"])("an unknown entity type (%s) fails closed with no call", async (entityType) => {
    expect((await executeDataImport("IMP-1", entityType)).ok).toBe(false);
    expect(H.calls).toEqual([]);
  });

  it.each(["CUSTOMERS", "EQUIPMENT", "SERVICE_HISTORY"])("%s still executes, with explicit approval", async (entityType) => {
    const res = await executeDataImport("IMP-1", entityType);
    expect(res.ok).toBe(true);
    expect(H.calls).toEqual([["executeDataImport", { jobId: "IMP-1", approved: true }]]);
    expect(catalogImportRefusal(entityType)).toBe(null);
  });
});

describe("the screen does not offer what it would refuse", () => {
  const allow = (id) => id === "admin.dataImport.stage" || id === "admin.dataImport.execute";

  async function stageFile(entityType) {
    H.stageJob = job(entityType);
    const { container } = render(<AdminDataImport hasCapability={allow} />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(["A\nX-1\n"], "f.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(H.calls.some(([n]) => n === "stageDataImport")).toBe(true));
  }

  it("the page subtitle names Parts and Inventory as unavailable instead of offering them", () => {
    render(<AdminDataImport hasCapability={allow} />);
    expect(screen.getByText(/Parts and Inventory import are unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Load Parts/)).toBeNull();
  });

  it.each([["PARTS", "Part import is not available."], ["INVENTORY", "Inventory import is not available."]])(
    "a staged %s file is refused: no preview, no Approve, nothing executed",
    async (entityType, headline) => {
      await stageFile(entityType);
      expect(await screen.findByText(headline)).toBeTruthy();
      expect(screen.queryByText(/Approve and import/)).toBeNull();
      expect(screen.queryByText("3. Preview")).toBeNull();
      expect(H.calls.some(([n]) => n === "executeDataImport")).toBe(false);
    },
  );

  it("a CUSTOMERS file still previews and can be approved", async () => {
    await stageFile("CUSTOMERS");
    const approve = await screen.findByText(/Approve and import 1 record/);
    fireEvent.click(approve);
    await waitFor(() => expect(H.calls.some(([n]) => n === "executeDataImport")).toBe(true));
  });
});

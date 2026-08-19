// H14 -- Technicians.jsx destructured only { data: technicians, loading }
// from useFirestoreCollection(TECHNICIANS_COLLECTION), even though that hook
// already exposes `error` (see hooks/useFirestoreCollection.js's own header:
// "hardened so a denied read fails VISIBLY"). A denied/failed Technicians
// read rendered the exact same "No technicians yet." empty copy as a
// genuinely empty roster -- the exact bug Jobs.jsx was fixed for
// (site-work #3), sitting in its sibling.
//
// This test pins the fix: a truthy `error` must render a distinct alert
// failure, never "No technicians yet.". useFirestoreCollection is mocked (no
// Firebase, no network) so both states can be driven directly, mirroring
// test/dispatchSurfacesErrorState.test.jsx.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/domain/jobActions", () => ({ createTechnician: vi.fn() }));

import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import Technicians from "../src/modules/technicians/Technicians";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Technicians -- error is not swallowed into the empty state (H14)", () => {
  it("renders an alert, not 'No technicians yet.', when useFirestoreCollection returns an error", () => {
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: { code: "permission-denied" } });
    render(<Technicians />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no technicians yet/i)).toBeNull();
  });

  it("still shows the honest empty state when there is no error", () => {
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
    render(<Technicians />);
    expect(screen.getByText(/no technicians yet/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loading: shows the loading state, not the failure or empty state", () => {
    useFirestoreCollection.mockReturnValue({ data: [], loading: true, error: null });
    render(<Technicians />);
    expect(screen.getByText(/loading technicians/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resolved with data: renders the table, not a failure", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "t1", name: "Jane", phone: "555-0100", status: "available" }],
      loading: false,
      error: null,
    });
    render(<Technicians />);
    expect(screen.getByText("Jane")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Coordinated Operations SURFACES — render tests (vitest + jsdom). Exercises the Service/Dispatch
// (CoordinatedVisitsWorkspace) and Technician (CoordinatedMissionView) consumers of the coordinatedVisit /
// coordinatedFieldMission projections over the injected SYNTHETIC source. Verifies the honest Product truth:
// partial completion is not complete, the material blocker is ROUTED (not fabricated), and an unconnected
// source renders an honest "not connected" state.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import CoordinatedVisitsWorkspace from "../src/modules/service/CoordinatedVisitsWorkspace.jsx";
import CoordinatedMissionView from "../src/modules/mobile/CoordinatedMissionView.jsx";
import {
  syntheticCoordinatedOperationsSource,
  inertCoordinatedOperationsSource,
} from "../src/access/coordinatedOperationsSource.js";

afterEach(cleanup);

describe("CoordinatedVisitsWorkspace (Service/Dispatch)", () => {
  const src = syntheticCoordinatedOperationsSource;

  it("lists coordinated visits with the attention (C713×5) visit sorted first", () => {
    render(<CoordinatedVisitsWorkspace source={src} />);
    expect(screen.getByRole("heading", { name: "Coordinated Visits" })).toBeTruthy();
    const rows = screen.getAllByRole("button").filter((el) => el.tagName === "TR");
    // Metro (ATTENTION) must be the first row; Harbor (READY) after it
    expect(within(rows[0]).getByText("Metro School District")).toBeTruthy();
  });

  it("shows honest partial completion — 3/5, explicitly NOT complete", () => {
    render(<CoordinatedVisitsWorkspace source={src} />);
    // default selection is the attention-first Metro visit → its detail shows completion progress
    expect(screen.getByText(/3\s*of\s*5\s*complete/i)).toBeTruthy();
    expect(screen.getByText(/outstanding/i)).toBeTruthy(); // "N units outstanding" — not complete
  });

  it("exposes the material blocker but ROUTES the unconnected replenishment (no fabricated resolution)", () => {
    render(<CoordinatedVisitsWorkspace source={src} />);
    expect(screen.getByText(/PRT-C713-COMPRESSOR/)).toBeTruthy();
    expect(screen.getByText(/replenishment status not connected/i)).toBeTruthy();
  });

  it("renders an honest not-connected state when the source is unavailable", () => {
    render(<CoordinatedVisitsWorkspace source={inertCoordinatedOperationsSource} />);
    expect(screen.getByText(/source is not connected yet/i)).toBeTruthy();
  });

  it("surfaces committed-obligation attention (C713×5 blocked unit is material) as WAITING_ON_MATERIAL", () => {
    render(<CoordinatedVisitsWorkspace source={src} />);
    // the default (attention-first) Metro visit has a blocked unit with a material blocker → intervention
    expect(screen.getByText(/Obligation attention/i)).toBeTruthy();
    expect(screen.getByText(/Waiting on material/i)).toBeTruthy();
    expect(screen.getByText(/intervention may be required/i)).toBeTruthy();
  });
});

describe("CoordinatedMissionView (Technician)", () => {
  const src = syntheticCoordinatedOperationsSource;

  it("renders ONE mission with N independent equipment units (not merged)", () => {
    render(<CoordinatedMissionView source={src} />);
    expect(screen.getByRole("heading", { name: "Coordinated Mission" })).toBeTruthy();
    // 5 equipment units, each its own execution card
    expect(screen.getByText(/Equipment units \(5\)/)).toBeTruthy();
    expect(screen.getByText("Taylor C713 · unit 1")).toBeTruthy();
    expect(screen.getByText("Taylor C713 · unit 5")).toBeTruthy();
  });

  it("shows honest overall progress (3 of 5) and per-unit blocker routed", () => {
    render(<CoordinatedMissionView source={src} />);
    expect(screen.getByText(/3\s*of\s*5\s*complete/i)).toBeTruthy();
    expect(screen.getByText(/not complete/i)).toBeTruthy();
    // the blocked unit's material blocker is routed, not fabricated
    expect(screen.getByText(/replenishment not connected/i)).toBeTruthy();
  });

  it("renders an honest not-connected state when the source is unavailable", () => {
    render(<CoordinatedMissionView source={inertCoordinatedOperationsSource} />);
    expect(screen.getByText(/source is not connected yet/i)).toBeTruthy();
  });
});

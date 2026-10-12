// Shared test kit for the grant-impact PREVIEW step (PR 4): every Administration authority change is previewed by the
// server before Confirm is enabled, and Confirm sends the preview's digest. Not a suite (no `.test.` in its name).
import { expect, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";

export const PREVIEW_DIGEST = "d".repeat(64);

/** A previewAuthorityChange answer in the server's shape (adminPolicyApi.ts previewAuthorityChange). */
export function previewReport(over = {}) {
  return {
    outcome: "WOULD_APPLY",
    refusal: null,
    busy: null,
    operation: "grantObjectActionToRole",
    perAction: null,
    affectedCount: 1,
    unaffectedHolders: 0,
    protectedAffected: { owners: 0, administrators: 0 },
    detail: "COUNTS_ONLY",
    // The existing component tests exercise the MANDATORY behaviour (the digest is sent, preview failures fail closed).
    previewMandatory: true,
    digests: { inputDigest: "i".repeat(64), policyStateDigest: "p".repeat(64), beforeDigest: "b".repeat(64), impactDigest: "m".repeat(64), previewDigest: PREVIEW_DIGEST },
    ...over,
  };
}

/** A seam-level `previewAuthorityChange(operation, args)` mock that answers WOULD_APPLY. */
export const wouldApplyPreview = (over = {}) => vi.fn(async (operation) => ({ ok: true, data: previewReport({ operation, ...over }) }));

/** Click "Preview impact" inside `scope` and wait for the server's WOULD_APPLY report. */
export async function previewImpact(scope, outcome = "WOULD_APPLY") {
  const root = scope ?? document.body;
  fireEvent.click(within(root).getByRole("button", { name: /^Preview impact/ }));
  await waitFor(() => expect(root.querySelector(`[data-authority-preview="${outcome}"]`)).toBeTruthy());
}

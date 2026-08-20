import { useCallback, useRef, useState } from "react";
import { opportunityCommandClient } from "../services/opportunityCommandClient.js";
import { outcomeFromErrorCode, outcomeFromUpdateResult } from "../domain/opportunityCommandOutcome.js";
import { buildSectionSaveInput } from "../domain/opportunitySectionSave.js";

function newIdempotencyKey() {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `opp-up-${uuid}`.slice(0, 200);
}

// Opportunity SECTION SAVE hook — the only place updateOpportunity is invoked from the workspace.
// `deps.client` injects a mocked client in tests (the seam useOpportunityTransitions and
// useSalesOrderActions already established).
//
// IDEMPOTENCY KEY STRATEGY. A key is generated ONCE per section-save intent and reused across a
// RETRY of that same intent, so a network-level double-send cannot apply twice. It is discarded
// on success and deliberately kept after a failure — the retry is the case it exists for.
//
// The key is scoped by opportunityId AND sectionId. Server-side the replay identity is now
// mkAuditId("updateOpportunity", actorUid, `${opportunityId}|${key}`), so a key leaking across
// Opportunities can no longer take a false replay branch — but scoping here is still what keeps
// two DIFFERENT sections of the SAME Opportunity from sharing one key, which the server has no
// way to distinguish and would correctly treat as one repeated intent.
//
// A VERSION CONFLICT DISCARDS THE KEY. The user's next attempt is a genuinely new intent against
// a version they have now seen; reusing the old key would make the server replay the FAILED
// call's identity rather than apply the reapplied edit.
export function useOpportunitySectionSave(opportunityId, deps) {
  const client = deps?.client ?? opportunityCommandClient;
  const [pending, setPending] = useState({});
  const [outcome, setOutcome] = useState(null);
  const keysRef = useRef({});

  const scopeRef = useRef(opportunityId);
  if (scopeRef.current !== opportunityId) {
    scopeRef.current = opportunityId;
    keysRef.current = {};
    // Outcome belongs to the Opportunity it was produced for. Carrying "Saved." across a
    // selection change would attribute one record's result to another.
    if (outcome !== null) setOutcome(null);
  }

  const clearOutcome = useCallback(() => setOutcome(null), []);

  const saveSection = useCallback(
    async (sectionId, draft, expectedUpdatedAtMillis) => {
      const built = buildSectionSaveInput({
        opportunityId,
        expectedUpdatedAtMillis,
        idempotencyKey: keysRef.current[sectionId] ?? (keysRef.current[sectionId] = newIdempotencyKey()),
        draft,
      });

      // A draft key the governed command cannot write. Surfaced, never swallowed: the command
      // ignores unknown keys, so sending one would report a save that changed nothing the user
      // asked for. This means the field model and the command have drifted apart.
      if (built.unsupported) {
        const result = {
          kind: "error",
          message: `This form has a field the system cannot save yet (${built.unsupported.join(", ")}). Nothing was changed.`,
        };
        setOutcome({ sectionId, ...result });
        return result;
      }

      setPending((p) => ({ ...p, [sectionId]: true }));
      setOutcome(null);
      try {
        const { result, errorStatus, errorDetail } = await client.updateOpportunity(built.input);
        const mapped = errorStatus
          ? outcomeFromErrorCode(errorStatus, errorDetail)
          : outcomeFromUpdateResult(result);

        // Success and NO_CHANGES both end the intent — in neither case is there anything left
        // to retry. A conflict ends it too, for the reason in this hook's header.
        if (mapped.kind === "applied" || mapped.kind === "replayed" || mapped.kind === "noop" || mapped.kind === "conflict") {
          delete keysRef.current[sectionId];
        }
        setOutcome({ sectionId, ...mapped });
        return mapped;
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[sectionId];
          return next;
        });
      }
    },
    [client, opportunityId]
  );

  return { pending, outcome, saveSection, clearOutcome };
}

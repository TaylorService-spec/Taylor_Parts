// The SERVER's condition vocabulary for the condition picker (listSupportedConditionKinds).
//
// Returns { status, kinds, error }. `kinds` is null unless the server answered with a readable catalog;
// a missing operation (UNKNOWN_OPERATION), a refusal or an unreadable payload all leave the picker
// DISABLED with the reason -- there is no local fallback vocabulary.
import { useMemo } from "react";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { conditionVocabularyFrom } from "./controlPlaneModel.js";

export function useConditionVocabulary(api) {
  const read = useControlPlaneRead(() => api.listSupportedConditionKinds(), "conditionKinds");
  return useMemo(() => {
    if (read.status !== "ready") return { status: read.status, kinds: null, error: read.error };
    const kinds = conditionVocabularyFrom(read.data);
    return kinds
      ? { status: "ready", kinds, error: null }
      : { status: "failed", kinds: null, error: { ok: false, code: "UNREADABLE_PAYLOAD", message: "the condition vocabulary payload could not be read" } };
  }, [read.status, read.data, read.error]);
}

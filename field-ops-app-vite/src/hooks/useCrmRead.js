import { useCallback, useEffect, useState } from "react";

// One-shot EOS API read with the lifecycle every CRM hook shares: loading, a SAFE error, an obsolete-response guard and
// an explicit retry. Not a live subscription: callers refetch after their own writes (retry), and a stamp says when the
// read last answered.
export function useCrmRead(key, run) {
  const [state, setState] = useState({ value: null, loading: true, error: null, checkedAt: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.resolve()
      .then(run)
      .then(
        ({ value, error }) => { if (active) setState({ value: error ? null : value, loading: false, error: error ?? null, checkedAt: Date.now() }); },
        () => { if (active) setState({ value: null, loading: false, error: "Couldn't load customer records. Please try again.", checkedAt: Date.now() }); },
      );
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures run's inputs
  }, [key, attempt]);

  return { ...state, retry };
}

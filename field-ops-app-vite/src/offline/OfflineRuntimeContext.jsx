import { createContext, useContext } from "react";

// ONE QUEUE PER TECHNICIAN, PER DEVICE.
//
// ============================ THE BUG THIS PREVENTS ============================
//
// TechnicianShell composes FieldMode. Both want the offline runtime. Without this, mounting the shell
// would create TWO runtimes over the SAME durable store — two in-memory queues, two `setQueue` paths,
// two writers of one storage key. The last one to persist would silently erase whatever the other had
// just captured, and the technician would watch an entry they made vanish with no error anywhere.
//
// That is not a hypothetical: it is what WO-03A's first integration step would have shipped, because
// each surface independently and reasonably called the hook.
//
// So the runtime is PROVIDED once, at the top of the technician experience, and consumed below. A
// surface rendered outside a provider still works — it makes its own — because a component must not
// depend on where it happens to be mounted to function at all.

const OfflineRuntimeContext = createContext(null);

export const OfflineRuntimeProvider = OfflineRuntimeContext.Provider;

/**
 * The runtime provided from above, or null if this surface is standing on its own.
 *
 * Callers pair this with `useOfflineRuntime({ disabled: !!provided })`: the hook is still called
 * unconditionally — hooks must be — but it does no storage work when something above already owns
 * the queue.
 */
export function useProvidedOfflineRuntime() {
  return useContext(OfflineRuntimeContext);
}

export default OfflineRuntimeContext;

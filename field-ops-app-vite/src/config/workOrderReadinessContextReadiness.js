// North Star Work Order readiness context — the single fail-closed client transport gate.
//
// The trusted server assembler has its own deploy lifecycle, separate from the inventory-balance
// callable it composes. Therefore this flag is deliberately independent of
// INVENTORY_BALANCE_READ_READY: enabling one must never make the browser assume the other exists.
//
// While false, services/workOrderReadinessContextClient.js makes ZERO callable attempts and does not
// load Firebase Functions. The value comes only from config/environments.json through vite.config.js.
// scripts/resolveEnvironment.mjs requires the boolean explicitly for every environment, so omission is
// a build error rather than a default-to-enabled path.
export const WORK_ORDER_READINESS_CONTEXT_READY =
  __APP_READINESS__.WORK_ORDER_READINESS_CONTEXT_READY;

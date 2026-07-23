// F-RULES-1 Gate D1 -- trusted completion is ACTIVE in production.
// completeAssignedJob is deployed and verified (see docs/audits/f-rules-1/
// d1-activation/), so Field Mode's completion routes through the trusted
// callable everywhere. The pre-D1 legacy client-transaction branch in
// FieldMode.jsx is now dead code (removed in a later cleanup); Gate D2
// (deploy the hardened PR-C Rules) then denies the direct path outright.
// History: before D1 this gate was `import.meta.env.DEV && ?emulator=1`
// (statically unreachable in production builds) so the auto-published
// GitHub Pages build could never invoke an undeployed callable -- see
// docs/implementation-plans/technician-self-write.md, PR-B posture.
export const TRUSTED_COMPLETION_ENABLED = true;

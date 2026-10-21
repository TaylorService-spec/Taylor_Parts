// THE SELF-APPROVAL EXEMPTION FAMILY, as Administration PRESENTS it (SAE Rule 2, DECISIONS #SAE-2).
//
// The seven approval.selfApproval.exempt* keys live on ONE governed Object. The SERVER gates every grant, revoke, condition and
// staffing of that Object on the verified protected Owner (functions/src/adminPolicy/exemptionAdministration.ts) and refuses anyone
// else, the Administrator included, before reading the request. This module decides NOTHING: it only names the Object so a change
// to it says, before it is confirmed, who may make it. The server's refusal still shows verbatim.
export const SELF_APPROVAL_EXEMPT_OBJECT = "selfApprovalExemption";

export const isExemptionFamilyObject = (objectKey) => typeof objectKey === "string" && objectKey.trim() === SELF_APPROVAL_EXEMPT_OBJECT;

export const EXEMPTION_OWNER_ONLY_NOTE =
  "Only the protected Owner can grant or revoke a self-approval exemption. Anyone else is refused by the server and nothing is saved. A grant applies across all operating companies and lets its holder approve their own request in its workflow scope; it adds no other authority.";

// THE HUMAN-FACING PRINCIPAL LABEL (Pass 10 UI truthfulness repair, D4/D5). One convention for every
// Administration surface that names a Principal: the display name when there is one, otherwise the existing
// "Unnamed Principal" wording (EmployeeProfileSections). Never the internal id and never the login subject --
// an id, where a surface shows one at all, is a separately labelled diagnostic.
export const UNNAMED_PRINCIPAL = "Unnamed Principal";

export function principalLabel(principal) {
  const name = typeof principal?.displayName === "string" ? principal.displayName.trim() : "";
  return name || UNNAMED_PRINCIPAL;
}

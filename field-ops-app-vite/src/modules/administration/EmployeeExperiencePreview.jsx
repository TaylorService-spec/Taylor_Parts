// VIEW AS USER — a READ-ONLY preview of the EOS experience the SERVER resolves for this employee (DECISIONS #210).
//
// Not impersonation: no session is issued for the subject and the administrator stays signed in as themselves. The server
// (previewMyWorkAs on /operations/workspace, admin.principalAccess.read) resolves the subject with the SAME resolver as a real
// request and runs the read-only workspace over it; every preview is audited. This panel renders that result with the SAME
// MyWorkspace component the subject sees, inside a frame marked PREVIEW -- so there is no second rendering of anyone's access.
// Links inside the preview open records as the ADMINISTRATOR (the caller), never as the subject.
import { useCallback, useState } from "react";
import { Button } from "../../shared/ui/primitives";
import { FormError } from "../../shared/ui/form";
import MyWorkspace from "../workspace/MyWorkspace.jsx";
import { callWorkspaceApi } from "../../services/workspaceApiClient";

export default function EmployeeExperiencePreview({ employeeId, callApi = callWorkspaceApi }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  // MyWorkspace asks for "readMyWork"; the preview answers it with the server's preview for THIS employee.
  // STABLE (useCallback): MyWorkspace re-reads whenever its callApi changes, so a fresh function per render would re-read --
  // and audit -- in a loop. One preview per open (and per company change), never per render.
  const previewCall = useCallback(async (operation, input = {}) => {
    if (operation !== "readMyWork") return { ok: false, message: "not available in a preview" };
    const res = await callApi("previewMyWorkAs", { employeeId, ...input, reason: "Administration: View as user" });
    if (!res.ok) { setError(res.message ?? "The preview could not be resolved."); return res; }
    setError(null);
    setMeta(res.result);
    return { ok: true, result: res.result.work };
  }, [callApi, employeeId]);

  if (!open) {
    return (
      <div>
        <p className="fo-muted">See the workspace EOS resolves for this person — their persona, sections, reach and refusals — read-only.
          No session is issued for them and nothing can be changed from the preview. Every preview is audited.</p>
        <Button variant="secondary" onClick={() => setOpen(true)}>View as user (preview)</Button>
      </div>
    );
  }
  return (
    <div className="fo-preview-frame" role="region" aria-label="View as user preview" data-preview="true">
      <p className="fo-preview-frame__banner"><strong>PREVIEW — read-only.</strong> What EOS resolves for this employee, as the server
        decides it. You remain signed in as yourself.{meta?.auditEventId ? ` Audited (${meta.auditEventId}).` : ""}</p>
      {meta && (
        <p className="fo-muted" data-preview-subject>Security Roles: {meta.subject.securityRoleKeys.join(", ") || "none"} · {meta.capabilities.length} capabilities
          {meta.scopedHeld.length ? ` · ${meta.scopedHeld.length} scope-qualified (${[...new Set(meta.scopedHeld.map((h) => `${h.scopeType}:${h.scopeValue}`))].join(", ")})` : ""}</p>
      )}
      {error && <FormError>{error}</FormError>}
      <MyWorkspace callApi={previewCall} preview />
      <Button variant="secondary" onClick={() => { setOpen(false); setMeta(null); }}>Close preview</Button>
    </div>
  );
}

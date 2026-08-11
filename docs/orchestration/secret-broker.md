# EOS Secret Broker — OpenAI review capability

## Security boundary

Credential availability, work authorization, and budget authorization are independent gates. A live `OPENAI_REVIEW` invocation is eligible only when all three pass. Possessing encrypted credential bytes grants no work or spend authority.

The broker maps `OPENAI_REVIEW` to `OPENAI_API_KEY`, but exposes only:

```js
credentialStatus("OPENAI_REVIEW")
withCredential("OPENAI_REVIEW", authorizedInvocation, callback)
```

There is no secret-read/export MCP tool or public broker function. Status returns `credentialId: "eos-openai-review"` and `secretValue: "REDACTED"`. The existing OpenAI review adapter receives an injected transport created by `openaiCredentialTransport.mjs`; it never receives or stores the API key.

An authorization grant must bind `capability`, `workId`, `reviewId`, `authorizationState: "AUTHORIZED"`, `budgetAuthorizationState: "AUTHORIZED"`, positive `maxSpendUsd`, exact `sourceCommit`, and `provenance`. The broker accepts only an ID/location/SHA-256-verified artifact and validates it before decrypting. The trusted transport also refuses when its injected spend estimate exceeds the artifact's ceiling. It does not decide product authority or calculate pricing; the existing EOS budget gate supplies that estimate.

## Windows storage and one-time provisioning

The local provider stores raw DPAPI ciphertext at:

```text
%LOCALAPPDATA%\EOS\secrets\OPENAI_API_KEY.dpapi
```

Provision once in a local PowerShell session controlled by the Owner:

```powershell
.\tools\eos-secrets\Set-EOSSecret.ps1 -Name OPENAI_API_KEY
```

The prompt hides input. Encryption uses Windows DPAPI `CurrentUser` plus capability-specific entropy. The helper prints only the encrypted file location. Neither plaintext nor ciphertext is committed.

DPAPI CurrentUser binds decryption to the same Windows user profile. The trusted EOS runtime must run under that user and should be isolated from untrusted same-user processes; DPAPI does not defend against arbitrary code already executing as that Windows identity.

## Fail-closed outcomes

- `SECRET_NOT_CONFIGURED`
- `SECRET_DECRYPT_FAILED`
- `UNSUPPORTED_PLATFORM`
- `CAPABILITY_NOT_ALLOWED`
- `WORK_NOT_AUTHORIZED`
- `BUDGET_NOT_AUTHORIZED`
- `SECRET_EXPOSURE_BLOCKED`
- `CAPABILITY_EXECUTION_FAILED`

Errors contain codes only. Broker logs contain capability/work/review/credential identifiers, never secret material. Callback results are scanned and rejected if they contain the credential.

## MCP contract

PR #790 retains `eos.intake.read` and `eos.intake.submit` and adds `eos.authorize_review`. `authorize_review` creates a content-addressed GitHub authority artifact and PR; it neither resolves a credential nor invokes OpenAI. Tool enumeration is test-locked against names containing secret, credential, or API-key retrieval semantics.

No live OpenAI call, real secret provisioning, credential installation, hosting, or deployment is part of this repository change.

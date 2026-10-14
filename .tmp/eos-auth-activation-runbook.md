# EOS NONPROD auth activation: operator steps (no secrets in this file)

## Step 1: Render dashboard (eos-api-nonprod ONLY, never production)
Open `D:\eos-nonprod-secrets\render-nonprod-env.txt`. Add each of the six NAME=VALUE lines as an Environment Variable on **eos-api-nonprod**:
- EOS_AUTH_SIGNING_KEY_NONPROD, EOS_AUTH_SIGNING_KID, EOS_AUTH_VERIFY_KEYS
- EOS_AUTH_ISSUER, EOS_AUTH_AUDIENCE, EOS_PERSONA_ISSUER_CREDENTIAL_SHA256

Then save, and let it redeploy. Do NOT put `persona-issuer-credential.txt` on Render or in GitHub.
Tell Claude when the redeploy is live (Checkpoint A is run from Claude's side).

## Step 2: Render Shell on eos-api-nonprod, Checkpoint B (DRY RUN, writes nothing)
Paste this whole block:

```bash
cd ~/project/src/functions 2>/dev/null || cd /opt/render/project/src/functions
export EOS_ENVIRONMENT=nonprod
ids=$(node -e '
const {Client}=require("pg");const reg=require("../config/sandboxRoleIdentityRegistry.json");
const uid=(k)=>reg.roles.find(r=>r.key===k).uid;
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const q=async(u)=>(await c.query("SELECT id FROM eos_policy.principals WHERE identity_provider=$1 AND external_subject=$2",["firebase",u])).rows.map(r=>r.id);
const a=await q(uid("administrator")),o=await q(uid("ownerExecutive"));await c.end();
if(a.length!==1||o.length!==1){console.error("STOP: expected exactly one administrator and one owner principal");process.exit(2)}
console.log(a[0]+" "+o[0]);})()')
set -- $ids; ADMIN=$1; OWNER=$2; echo "administrator principal=$ADMIN owner principal=$OWNER"
for P in ownerExecutive generalManager officeManager administrator serviceManager dispatcher serviceTechnician partsAssociate partsManager warehouseAssociate warehouseManager retailSales nationalAccountsSales financeAccounting reportingAnalyst generalEmployee; do
  ACTOR=$ADMIN; [ "$P" = administrator ] && ACTOR=$OWNER   # self-binding is refused, so the Owner binds the Administrator
  echo "===== $P (actor $ACTOR) ====="
  node scripts/bindPrincipalEosIdentity.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
    --adminPrincipalId "$ACTOR" --persona "$P" \
    --reason "EOS identity boundary 2026-09-29: bind nonprod persona $P to its existing Principal (Controller authorized)"
  echo "exit=$?"
done
```

Copy the whole output back to Claude. Nothing is written in this step.

## Step 3: Checkpoint C (APPLY), only after Claude confirms the dry run is clean
Run the same block again with ` --apply` added to the end of the `node scripts/bindPrincipalEosIdentity.js ...` command. Copy the output back.

#!/usr/bin/env node
// Prove the two authentication layers in front of the private AI gateway are independent.
//
//   node scripts/verifyPrivateAiIngress.mjs
//
// WHY THIS EXISTS AS A SCRIPT RATHER THAN A TEST. It needs real Cloudflare Access service-token
// credentials and a real Keystone API key, so it can only be run by whoever holds them. It is
// therefore an operator harness, and its output is designed to be pasteable: every line is a test
// name, an HTTP status and a verdict, and no credential value can appear in any of them.
//
// WHAT IT PROVES, AND WHY THE MIDDLE CASE IS THE POINT.
//
//   1. Cloudflare Access admits a valid service token.
//   2. A valid Access token with a WRONG Keystone key is still refused BY KEYSTONE.
//   3. A valid Access token with the right Keystone key reaches the operational route.
//
// Without (2), (1) and (3) are equally consistent with a gateway that trusts anything Cloudflare
// lets through. (2) is what distinguishes two independent layers from one layer with a second
// decorative header.
//
// It sends a SYNTHETIC envelope only. It reads no EOS data and touches no Firestore.
//
// Credentials come from the environment, using the same names the Functions runtime uses:
//   KEYSTONE_GATEWAY_URL  KEYSTONE_GATEWAY_API_KEY  KEYSTONE_GATEWAY_TENANT_ID
//   KEYSTONE_ACCESS_CLIENT_ID  KEYSTONE_ACCESS_CLIENT_SECRET

const REQUIRED = [
  'KEYSTONE_GATEWAY_URL',
  'KEYSTONE_GATEWAY_API_KEY',
  'KEYSTONE_GATEWAY_TENANT_ID',
  'KEYSTONE_ACCESS_CLIENT_ID',
  'KEYSTONE_ACCESS_CLIENT_SECRET',
];

const TIMEOUT_MS = 30_000;

// Deliberately not "the last four characters". A fingerprint that reveals part of a secret is a
// convenience for whoever is reading the log and also for whoever else is.
const present = (value) => (typeof value === 'string' && value.trim().length > 0 ? 'SET' : 'MISSING');

function syntheticEnvelope() {
  return {
    schemaVersion: 1,
    classification: 'SYNTHETIC',
    synthetic: true,
    source: 'eos-private-ai-ingress-harness',
    domain: 'WORK_ORDER',
    subjectReference: null,
    observedFact: 'EOS assembled a synthetic readiness observation for ingress verification.',
    deterministicInterpretation: null,
    deterministicBusinessConsequence: null,
    evidence: [{ key: 'E1', kind: 'PLANNED_PART_KNOWN', summary: 'planned 1, used 0, outstanding 1, warehouse available 0' }],
    allowedRecommendation: null,
    mode: 'fast',
    maxOutputTokens: 256,
  };
}

async function request(url, { headers = {}, body = null } = {}) {
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text().catch(() => '');
    return { status: response.status, text, location: response.headers.get('location') };
  } catch (error) {
    return { status: 0, text: '', error: error?.name ?? 'RequestFailed' };
  }
}

/**
 * Classify a response WITHOUT echoing it. A gateway error body can carry an endpoint or a header
 * name, and this output is meant to be pasted into a chat window.
 */
function classify({ status, text, location, error }) {
  if (status === 0) return `transport failure (${error})`;
  if (location && /cloudflareaccess\.com/.test(location)) return 'redirected to the Cloudflare Access login';
  if (status === 200) {
    try {
      const parsed = JSON.parse(text);
      const keys = Object.keys(parsed).sort();
      const candidate = ['businessConsequence', 'confidence', 'confidenceBasis', 'evidenceRefs',
        'interpretation', 'recommendedActionId'];
      if (candidate.every((k) => keys.includes(k))) {
        return `strict interpretation candidate (recommendedActionId: ${parsed.recommendedActionId === null ? 'null' : 'PRESENT'})`;
      }
      if (keys.includes('status') && keys.includes('ollama')) {
        return `gateway health (status ${parsed.status}, ollama ${parsed.ollama})`;
      }
      return `json object with ${keys.length} keys`;
    } catch {
      return 'a non-JSON 200 body';
    }
  }
  return 'refused';
}

function report(name, expectation, result, passed) {
  const status = result.status === 0 ? 'ERR' : String(result.status);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      expected  ${expectation}`);
  console.log(`      HTTP ${status}  ${classify(result)}`);
  return passed;
}

async function main() {
  const env = process.env;
  console.log('PRIVATE AI INGRESS — TWO-LAYER VERIFICATION');
  console.log('credentials (presence only, values are never printed):');
  for (const name of REQUIRED) console.log(`  ${name}: ${present(env[name])}`);
  console.log('');

  const missing = REQUIRED.filter((name) => present(env[name]) === 'MISSING');
  if (missing.length > 0) {
    console.log(`RESULT: NOT_RUN — ${missing.length} required value(s) are not set`);
    return 2;
  }

  const base = env.KEYSTONE_GATEWAY_URL.replace(/\/+$/, '');
  if (!base.startsWith('https://')) {
    console.log('RESULT: NOT_RUN — the gateway URL is not HTTPS');
    return 2;
  }

  const access = {
    'CF-Access-Client-Id': env.KEYSTONE_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.KEYSTONE_ACCESS_CLIENT_SECRET,
  };
  const keystone = (apiKey) => ({ 'X-API-Key': apiKey, 'X-Tenant-ID': env.KEYSTONE_GATEWAY_TENANT_ID });
  const operational = `${base}/v1/operational/interpret`;
  let ok = true;

  // 0. The control. Without Access credentials nothing should reach the origin at all, and this is
  //    judged on the redirect rather than the status, because both layers answer 403.
  const anonymous = await request(`${base}/health`);
  ok = report('anonymous request is stopped by Cloudflare',
    'a Cloudflare Access challenge, never a Keystone response',
    anonymous,
    anonymous.status !== 200 && !/localhost|private-ingress/.test(anonymous.text)) && ok;

  // 1. Access layer.
  const health = await request(`${base}/health`, { headers: access });
  ok = report('valid Access service token reaches the gateway', 'HTTP 200 gateway health',
    health, health.status === 200) && ok;

  // 2. The independence proof.
  const wrongKey = await request(operational, {
    headers: { ...access, ...keystone('not-a-real-keystone-key') },
    body: syntheticEnvelope(),
  });
  ok = report('valid Access + WRONG Keystone key is refused by Keystone',
    'HTTP 401/403 from the origin, proving Cloudflare did not authenticate the tenant',
    wrongKey, wrongKey.status === 401 || wrongKey.status === 403) && ok;

  // 3. Full path.
  const full = await request(operational, {
    headers: { ...access, ...keystone(env.KEYSTONE_GATEWAY_API_KEY) },
    body: syntheticEnvelope(),
  });
  ok = report('valid Access + correct Keystone key reaches the model',
    'HTTP 200 with a strict interpretation candidate',
    full, full.status === 200 && classify(full).startsWith('strict interpretation candidate')) && ok;

  console.log('');
  console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log('credentials printed: NO');
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  // Never the message: a fetch failure's text can carry the endpoint.
  console.error(`RESULT: ERROR (${error?.name ?? 'unknown'})`);
  process.exit(1);
});

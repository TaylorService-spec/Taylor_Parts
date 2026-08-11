import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";

const env = { EOS_INTAKE_RESOURCE_URL: "https://eos.example/mcp", EOS_INTAKE_OAUTH_ISSUER: "https://id.example/", EOS_INTAKE_JWKS_URI: "https://id.example/jwks", EOS_INTAKE_GITHUB_OWNER: "owner", EOS_INTAKE_GITHUB_REPO: "repo", EOS_INTAKE_GITHUB_TOKEN: "secret" };
test("configuration is fail-closed and requires HTTPS", () => {
  assert.equal(loadConfig(env).audience, "https://eos.example/mcp");
  assert.throws(() => loadConfig({ ...env, EOS_INTAKE_RESOURCE_URL: "http://eos.example/mcp" }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, EOS_INTAKE_GITHUB_TOKEN: "" }), /GITHUB_TOKEN/);
});

const required = (env, key) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing required environment variable ${key}`);
  return value;
};

export function loadConfig(env = process.env) {
  const resource = new URL(required(env, "EOS_INTAKE_RESOURCE_URL"));
  const issuer = new URL(required(env, "EOS_INTAKE_OAUTH_ISSUER"));
  if (resource.protocol !== "https:" || issuer.protocol !== "https:") {
    throw new Error("resource and OAuth issuer URLs must use HTTPS");
  }
  return Object.freeze({
    port: Number(env.PORT || 3000),
    resource,
    issuer,
    audience: env.EOS_INTAKE_OAUTH_AUDIENCE?.trim() || resource.href,
    jwksUri: new URL(required(env, "EOS_INTAKE_JWKS_URI")),
    githubOwner: required(env, "EOS_INTAKE_GITHUB_OWNER"),
    githubRepo: required(env, "EOS_INTAKE_GITHUB_REPO"),
    githubToken: required(env, "EOS_INTAKE_GITHUB_TOKEN"),
    githubDefaultBranch: env.EOS_INTAKE_GITHUB_DEFAULT_BRANCH?.trim() || "main",
  });
}

import { loadConfig } from "./config.mjs";
import { JwtAccessTokenVerifier } from "./auth.mjs";
import { GitHubArtifactStore } from "./githubStore.mjs";
import { createApp } from "./app.mjs";

const config = loadConfig();
const verifier = new JwtAccessTokenVerifier(config);
const store = new GitHubArtifactStore({ owner: config.githubOwner, repo: config.githubRepo, token: config.githubToken, defaultBranch: config.githubDefaultBranch });
const server = createApp({ config, verifier, store }).listen(config.port, () => process.stdout.write(`EOS intake MCP listening on ${config.port}\n`));
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());

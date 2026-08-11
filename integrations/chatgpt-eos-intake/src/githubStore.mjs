import { resolveWorkIntake, statusPointer, resultPointer } from "../../../docs/orchestration/lib/workIntake.mjs";
import { intakeLocation, serializeArtifact, verifyResultManifest } from "./artifacts.mjs";

export class GitHubApiError extends Error {
  constructor(method, path, status, body) { super(`GitHub ${method} ${path} failed (${status}): ${body}`); this.status = status; }
}

export class GitHubArtifactStore {
  constructor({ owner, repo, token, defaultBranch = "main", fetchImpl = fetch }) {
    this.owner = owner; this.repo = repo; this.token = token; this.defaultBranch = defaultBranch; this.fetch = fetchImpl;
    this.base = `https://api.github.com/repos/${owner}/${repo}`;
  }

  async api(path, options = {}) {
    const response = await this.fetch(`${this.base}${path}`, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", ...options.headers } });
    if (!response.ok) throw new GitHubApiError(options.method || "GET", path, response.status, await response.text());
    return response.status === 204 ? null : response.json();
  }

  async submit(artifact) {
    const baseRef = await this.api(`/git/ref/heads/${encodeURIComponent(this.defaultBranch)}`);
    const branch = `eos-intake/${artifact.requestId.toLowerCase()}`;
    let created = true;
    try { await this.api(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }) }); }
    catch (error) { if (error.status !== 422) throw error; created = false; }
    if (!created) {
      const { value } = await this.readJson(artifact.artifactLocation, branch);
      if (value.sha256 !== artifact.sha256) throw new Error(`GitHub branch collision for ${artifact.requestId}`);
      const pulls = await this.api(`/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branch}`)}`);
      if (pulls.length !== 1) throw new Error(`expected one open intake pull request for ${artifact.requestId}`);
      return { branch, pullRequest: pulls[0].number, pullRequestUrl: pulls[0].html_url, sourceCommit: pulls[0].head.sha, replayed: true };
    }
    const write = await this.api(`/contents/${artifact.artifactLocation}`, { method: "PUT", body: JSON.stringify({ message: `intake: ${artifact.requestId}`, content: Buffer.from(serializeArtifact(artifact)).toString("base64"), branch }) });
    const pr = await this.api(`/pulls`, { method: "POST", body: JSON.stringify({ title: `intake: ${artifact.title}`, head: branch, base: this.defaultBranch, body: `Authenticated EOS intake artifact.\n\n\`${artifact.sha256}\`` }) });
    return { branch, pullRequest: pr.number, pullRequestUrl: pr.html_url, sourceCommit: write.commit.sha };
  }

  async readJson(location, ref = this.defaultBranch) {
    const item = await this.api(`/contents/${location}?ref=${encodeURIComponent(ref)}`);
    return { value: JSON.parse(Buffer.from(item.content, "base64").toString("utf8")), commitSha: item.sha };
  }

  async status(requestId) {
    const location = intakeLocation(requestId);
    let record; let pullRequest = null;
    try { record = await this.readJson(location); }
    catch (error) {
      if (error.status !== 404) throw error;
      const branch = `eos-intake/${requestId.toLowerCase()}`;
      record = await this.readJson(location, branch);
      const pulls = await this.api(`/pulls?state=all&head=${encodeURIComponent(`${this.owner}:${branch}`)}`);
      const pr = pulls[0];
      if (pr) pullRequest = { number: pr.number, url: pr.html_url, state: pr.merged_at ? "MERGED" : pr.state.toUpperCase() };
    }
    const { value, commitSha } = record;
    const artifact = resolveWorkIntake({ requestId, location, sha256: value.sha256, bytes: JSON.stringify(value) });
    return { pointer: statusPointer(requestId), requestId, status: artifact.status, authorizationState: artifact.authority.authorizationState, location, sha256: artifact.sha256, githubBlobSha: commitSha, relatedRefs: artifact.relatedRefs, ...(pullRequest ? { pullRequest } : {}) };
  }

  async result(requestId) {
    const directory = `docs/orchestration/work-intake/results/${requestId}`;
    let entries;
    try { entries = await this.api(`/contents/${directory}?ref=${encodeURIComponent(this.defaultBranch)}`); }
    catch (error) { if (error.status === 404) return { pointer: resultPointer(requestId), requestId, status: "PENDING" }; throw error; }
    const manifests = [];
    for (const entry of entries.filter((item) => item.name.endsWith(".result.json"))) {
      const { value } = await this.readJson(entry.path);
      if (value.requestId === requestId) manifests.push(verifyResultManifest(value));
    }
    if (!manifests.length) return { pointer: resultPointer(requestId), requestId, status: "PENDING" };
    manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = manifests[0];
    return { pointer: resultPointer(requestId), requestId, status: latest.status, location: latest.artifactLocation, sha256: latest.sha256, contentLocation: latest.contentLocation, contentSha256: latest.contentSha256, summary: latest.summary };
  }
}

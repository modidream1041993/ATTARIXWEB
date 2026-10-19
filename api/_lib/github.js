// A minimal GitHub REST client for the admin API (contents, git data, merges). The token (env GITHUB_TOKEN) is a
// fine-grained token for THIS repository only, Contents read & write. Nothing here ever force-updates a ref: every
// ref update is sent with force:false, so a non-fast-forward is refused by GitHub, never overwritten.
import { HttpError } from './http.js';

const API = 'https://api.github.com';

export function githubFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO;
  if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new HttpError(500, 'الخادم غير مُعدّ');
  return new GitHub({ token, repo, fetchImpl });
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  constructor({ token, repo, fetchImpl }) {
    this.token = token;
    this.repo = repo;
    this.fetch = fetchImpl;
  }

  async call(method, path, body, okStatuses = [200, 201]) {
    const res = await this.fetch(`${API}/repos/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'attarix-site-admin',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    if (res.status !== 204) {
      try { json = await res.json(); } catch { json = null; }
    }
    return { status: res.status, json, ok: okStatuses.includes(res.status) };
  }

  fail(what, status) {
    const e = new HttpError(502, 'تعذّر الاتصال بـ GitHub. حاول مرة أخرى.');
    e.code = `github:${what}:${status}`;
    return e;
  }

  async getRef(branch) {
    const r = await this.call('GET', `/git/ref/heads/${encPath(branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw this.fail('getRef', r.status);
    return r.json.object.sha;
  }

  async createRef(branch, sha) {
    const r = await this.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
    if (r.status === 422) return false; // already exists
    if (!r.ok) throw this.fail('createRef', r.status);
    return true;
  }

  // Moves a branch to `sha` only if that is a fast-forward. Returns false when GitHub refuses (not a fast-forward).
  async fastForward(branch, sha) {
    const r = await this.call('PATCH', `/git/refs/heads/${encPath(branch)}`, { sha, force: false });
    if (r.status === 422) return false;
    if (!r.ok) throw this.fail('updateRef', r.status);
    return true;
  }

  async getCommit(sha) {
    const r = await this.call('GET', `/git/commits/${sha}`);
    if (!r.ok) throw this.fail('getCommit', r.status);
    return r.json;
  }

  // path → blob sha, for every file of a commit's tree.
  async treeMap(commitSha) {
    const commit = await this.getCommit(commitSha);
    const r = await this.call('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    if (!r.ok || r.json.truncated) throw this.fail('getTree', r.status);
    const map = new Map();
    for (const e of r.json.tree) if (e.type === 'blob') map.set(e.path, e.sha);
    return { map, treeSha: commit.tree.sha };
  }

  // A file's text at a ref (branch or sha), or null if the file or the ref does not exist.
  async getText(path, ref) {
    const r = await this.call('GET', `/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    if (r.status === 404) return null;
    if (!r.ok || !r.json || r.json.type !== 'file') throw this.fail('getContents', r.status);
    let text;
    if (r.json.encoding === 'base64' && typeof r.json.content === 'string') text = Buffer.from(r.json.content, 'base64').toString('utf8');
    else {
      const b = await this.call('GET', `/git/blobs/${r.json.sha}`);
      if (!b.ok) throw this.fail('getBlob', b.status);
      text = Buffer.from(b.json.content, 'base64').toString('utf8');
    }
    return { text, sha: r.json.sha };
  }

  // Creates or replaces one file on a branch. `sha` = the blob being replaced (null for a new file). Returns false
  // on a conflict (someone else changed it first) so the caller can re-read and retry.
  async putText({ branch, path, text, message, sha }) {
    const r = await this.call('PUT', `/contents/${encPath(path)}`, {
      message, branch, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}),
    });
    if (r.status === 409 || r.status === 422) return false;
    if (!r.ok) throw this.fail('putContents', r.status);
    return true;
  }

  async createBlob(base64) {
    const r = await this.call('POST', '/git/blobs', { content: base64, encoding: 'base64' });
    if (!r.ok) throw this.fail('createBlob', r.status);
    return r.json.sha;
  }

  // One commit with several file changes on top of `parentSha`. entries: {path, base64} | {path, blobSha} | {path, remove:true}.
  // Returns the new commit sha (the branch is NOT moved — see commitOnBranch).
  async commitTree({ parentSha, entries, message }) {
    const base = await this.getCommit(parentSha);
    const tree = [];
    for (const e of entries) {
      if (e.remove) tree.push({ path: e.path, mode: '100644', type: 'blob', sha: null });
      else if (e.blobSha) tree.push({ path: e.path, mode: '100644', type: 'blob', sha: e.blobSha });
      else tree.push({ path: e.path, mode: '100644', type: 'blob', sha: await this.createBlob(e.base64) });
    }
    const t = await this.call('POST', '/git/trees', { base_tree: base.tree.sha, tree });
    if (!t.ok) throw this.fail('createTree', t.status);
    const c = await this.call('POST', '/git/commits', { message, tree: t.json.sha, parents: [parentSha] });
    if (!c.ok) throw this.fail('createCommit', c.status);
    return c.json.sha;
  }

  // Commits entries onto a branch's tip and fast-forwards the branch (retries once if the branch moved meanwhile).
  async commitOnBranch({ branch, entries, message }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tip = await this.getRef(branch);
      if (!tip) throw new HttpError(409, 'الفرع غير موجود');
      const sha = await this.commitTree({ parentSha: tip, entries, message });
      if (await this.fastForward(branch, sha)) return sha;
    }
    throw new HttpError(409, 'تغيّر الفرع أثناء الحفظ. حاول مرة أخرى.');
  }

  // An orphan commit (no parent) — used once, to start the admin-state branch.
  async createOrphanBranch(branch, files, message) {
    const tree = [];
    for (const f of files) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: await this.createBlob(Buffer.from(f.text, 'utf8').toString('base64')) });
    const t = await this.call('POST', '/git/trees', { tree });
    if (!t.ok) throw this.fail('createTree', t.status);
    const c = await this.call('POST', '/git/commits', { message, tree: t.json.sha, parents: [] });
    if (!c.ok) throw this.fail('createCommit', c.status);
    await this.createRef(branch, c.json.sha);
  }

  // A normal merge commit of head into base (GitHub merges API). Returns {merged:true, sha} | {merged:false} when
  // there was nothing to merge. A conflict is an error, never resolved by force.
  async merge(base, head, message) {
    const r = await this.call('POST', '/merges', { base, head, commit_message: message }, [201, 204]);
    if (r.status === 204) return { merged: false };
    if (r.status === 201) return { merged: true, sha: r.json.sha };
    if (r.status === 409) throw new HttpError(409, 'يوجد تعارض بين المعاينة والموقع المنشور — لا يمكن الدمج تلقائيًا.');
    throw this.fail('merge', r.status);
  }

  // How many commits `head` has that `base` does not.
  async aheadBy(base, head) {
    if (![base, head].every((b) => /^[A-Za-z0-9_./-]+$/.test(b))) throw new Error('bad branch name');
    const r = await this.call('GET', `/compare/${base}...${head}`);
    if (!r.ok) throw this.fail('compare', r.status);
    return { ahead: r.json.ahead_by, behind: r.json.behind_by };
  }
}

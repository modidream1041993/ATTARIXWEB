// An in-memory stand-in for the parts of GitHub's REST API the admin API uses, served through a fake `fetch`.
// It models commits, trees (path → blob), refs (with force:false = fast-forward only), the contents API with sha
// preconditions, the merges API (a real three-way merge of file maps, 409 on a conflict), and compare.
// It is NOT GitHub: it proves our logic against our understanding of the API, not GitHub's behaviour itself.
import { createHash } from 'node:crypto';

const h = (s) => createHash('sha1').update(s).digest('hex');

export class FakeGitHub {
  constructor() {
    this.blobs = new Map(); // sha → Buffer
    this.commits = new Map(); // sha → { tree: Map, parents: [], message }
    this.trees = new Map(); // treeSha → Map
    this.refs = new Map(); // branch → commit sha
    this.calls = [];
    this.seq = 0;
  }

  blob(buf) { const sha = h(`blob${buf.toString('base64')}`); this.blobs.set(sha, buf); return sha; }
  treeSha(map) { const sha = h(`tree${JSON.stringify([...map.entries()].sort())}`); this.trees.set(sha, new Map(map)); return sha; }
  commit(map, parents, message) {
    const sha = h(`commit${this.seq++}${this.treeSha(map)}${parents.join()}${message}`);
    this.commits.set(sha, { tree: new Map(map), treeSha: this.treeSha(map), parents, message });
    return sha;
  }
  // Seed a branch from {path: text|Buffer}.
  seed(branch, files, parent = null) {
    const map = parent ? new Map(this.commits.get(this.refs.get(parent)).tree) : new Map();
    for (const [p, v] of Object.entries(files)) map.set(p, this.blob(Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8')));
    const sha = this.commit(map, parent ? [this.refs.get(parent)] : [], `seed ${branch}`);
    this.refs.set(branch, sha);
    return sha;
  }
  filesAt(ref) {
    const sha = this.refs.get(ref) || ref;
    const c = this.commits.get(sha);
    const out = {};
    for (const [p, b] of c.tree) out[p] = this.blobs.get(b);
    return out;
  }
  textAt(ref, path) { const f = this.filesAt(ref)[path]; return f ? f.toString('utf8') : null; }
  ancestors(sha) {
    const seen = new Set();
    const stack = [sha];
    while (stack.length) { const s = stack.pop(); if (seen.has(s)) continue; seen.add(s); stack.push(...this.commits.get(s).parents); }
    return seen;
  }
  mergeBase(a, b) {
    const A = this.ancestors(a);
    // BFS from b, first one in A
    const queue = [b];
    const seen = new Set();
    while (queue.length) { const s = queue.shift(); if (seen.has(s)) continue; seen.add(s); if (A.has(s)) return s; queue.push(...this.commits.get(s).parents); }
    return null;
  }

  get fetch() {
    return async (url, init = {}) => {
      const u = new URL(url);
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      this.calls.push({ method, path: u.pathname, body });
      const m = /^\/repos\/[^/]+\/[^/]+(\/.*)$/.exec(u.pathname);
      const r = this.route(method, decodeURIComponent(m[1]), u.searchParams, body);
      return { status: r[0], json: async () => r[1] };
    };
  }

  route(method, path, q, body) {
    let m;
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = this.refs.get(m[1]);
      return sha ? [200, { object: { sha } }] : [404, { message: 'Not Found' }];
    }
    if (method === 'POST' && path === '/git/refs') {
      const b = body.ref.replace(/^refs\/heads\//, '');
      if (this.refs.has(b)) return [422, { message: 'Reference already exists' }];
      this.refs.set(b, body.sha);
      return [201, {}];
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const cur = this.refs.get(m[1]);
      if (!cur) return [422, {}];
      if (body.force !== false) throw new Error('the code must always send force:false');
      if (!this.ancestors(body.sha).has(cur)) return [422, { message: 'Update is not a fast forward' }];
      this.refs.set(m[1], body.sha);
      return [200, {}];
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const c = this.commits.get(m[1]);
      return c ? [200, { sha: m[1], tree: { sha: c.treeSha }, parents: c.parents.map((sha) => ({ sha })) }] : [404, {}];
    }
    if (method === 'GET' && (m = /^\/git\/trees\/(\w+)$/.exec(path))) {
      const t = this.trees.get(m[1]);
      return [200, { truncated: false, tree: [...t.entries()].map(([p, sha]) => ({ path: p, type: 'blob', sha })) }];
    }
    if (method === 'POST' && path === '/git/blobs') return [201, { sha: this.blob(Buffer.from(body.content, 'base64')) }];
    if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(path))) return [200, { content: this.blobs.get(m[1]).toString('base64'), encoding: 'base64' }];
    if (method === 'POST' && path === '/git/trees') {
      const map = body.base_tree ? new Map(this.trees.get(body.base_tree)) : new Map();
      for (const e of body.tree) {
        if (e.sha === null) map.delete(e.path);
        else { if (!this.blobs.has(e.sha)) return [422, { message: 'bad blob' }]; map.set(e.path, e.sha); }
      }
      return [201, { sha: this.treeSha(map) }];
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = this.commit(this.trees.get(body.tree), body.parents, body.message);
      return [201, { sha }];
    }
    if ((m = /^\/contents\/(.+)$/.exec(path))) {
      if (method === 'GET') {
        const ref = q.get('ref');
        const sha = this.refs.get(ref) || (this.commits.has(ref) ? ref : null);
        if (!sha) return [404, {}];
        const blobSha = this.commits.get(sha).tree.get(m[1]);
        if (!blobSha) return [404, {}];
        return [200, { type: 'file', sha: blobSha, encoding: 'base64', content: this.blobs.get(blobSha).toString('base64') }];
      }
      if (method === 'PUT') {
        const tip = this.refs.get(body.branch);
        if (!tip) return [404, {}];
        const map = new Map(this.commits.get(tip).tree);
        const cur = map.get(m[1]);
        if ((cur || null) !== (body.sha || null)) return [409, { message: 'sha mismatch' }];
        map.set(m[1], this.blob(Buffer.from(body.content, 'base64')));
        this.refs.set(body.branch, this.commit(map, [tip], body.message));
        return [cur ? 200 : 201, {}];
      }
    }
    if (method === 'POST' && path === '/merges') {
      const base = this.refs.get(body.base);
      const head = this.refs.get(body.head);
      if (this.ancestors(base).has(head)) return [204, null];
      const mb = this.mergeBase(base, head);
      const B = this.commits.get(base).tree;
      const H = this.commits.get(head).tree;
      const O = mb ? this.commits.get(mb).tree : new Map();
      const out = new Map(B);
      for (const p of new Set([...B.keys(), ...H.keys(), ...O.keys()])) {
        const o = O.get(p); const b = B.get(p); const hh = H.get(p);
        if (hh === o) continue;
        if (b === o || b === hh) { if (hh === undefined) out.delete(p); else out.set(p, hh); continue; }
        return [409, { message: 'Merge conflict' }];
      }
      const sha = this.commit(out, [base, head], body.commit_message);
      this.refs.set(body.base, sha);
      return [201, { sha }];
    }
    if (method === 'GET' && (m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(path))) {
      const a = this.refs.get(m[1]); const b = this.refs.get(m[2]);
      const A = this.ancestors(a); const B = this.ancestors(b);
      return [200, { ahead_by: [...B].filter((x) => !A.has(x)).length, behind_by: [...A].filter((x) => !B.has(x)).length }];
    }
    throw new Error(`fake GitHub: no route for ${method} ${path}`);
  }
}

// A minimal req/res pair for calling a Vercel-style handler directly.
export function fakeReq({ method = 'GET', body, headers = {}, cookie } = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: {
      host: 'admin.test',
      ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.parse(text),
  };
  return req;
}
export function fakeRes() {
  const res = {
    statusCode: 0, headers: {}, text: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(t) { this.text = t; this.json = JSON.parse(t); },
  };
  return res;
}

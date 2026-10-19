// Persistent admin state with no extra service: small files on a dedicated ORPHAN branch `admin-state` of the site
// repository (it shares no history with the site, and its own vercel.json turns its deployments off).
//
//   lockout.json           { failures, lockedUntil, lastTotpStep }   — the login lockout, across serverless invocations
//   log.jsonl              one JSON object per line, only ever appended — who/when/what
//   publish-history.json   [{ id, at, mainBefore, status, mergeSha, rolledBack, rollbackSha }]
//
// Every write is a conditional update on the file's current blob sha; a concurrent change makes it re-read and
// re-apply (never a blind overwrite).
import { HttpError } from './http.js';

export const STATE_BRANCH = 'admin-state';

const README = `# admin-state\n\nState of the site's content-admin panel (/admin). Written ONLY by the admin API.\nDo not merge this branch anywhere; it shares no history with the site.\n`;
const VERCEL = `${JSON.stringify({ git: { deploymentEnabled: false } }, null, 2)}\n`;

export class StateStore {
  constructor(gh) {
    this.gh = gh;
    this.ready = null;
  }

  ensure() {
    if (!this.ready) {
      this.ready = (async () => {
        if (await this.gh.getRef(STATE_BRANCH)) return;
        await this.gh.createOrphanBranch(STATE_BRANCH, [
          { path: 'README.md', text: README },
          { path: 'vercel.json', text: VERCEL },
        ], 'admin-state: start');
        if (!(await this.gh.getRef(STATE_BRANCH))) throw new HttpError(502, 'تعذّر تجهيز مخزن الحالة');
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  async readText(name) {
    await this.ensure();
    return this.gh.getText(name, STATE_BRANCH);
  }

  async readJson(name, fallback) {
    const f = await this.readText(name);
    if (!f) return { data: structuredClone(fallback), sha: null };
    try { return { data: JSON.parse(f.text), sha: f.sha }; } catch { throw new HttpError(500, 'ملف الحالة تالف'); }
  }

  // Read → mutate(copy) → conditional write; on a conflict, read again and re-apply. mutate returns the new data
  // (or undefined to write nothing) and may stash a result on the returned object's side via the closure.
  async updateJson(name, fallback, mutate, message) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, sha } = await this.readJson(name, fallback);
      const next = mutate(structuredClone(data));
      if (next === undefined) return data;
      if (await this.gh.putText({ branch: STATE_BRANCH, path: name, text: `${JSON.stringify(next, null, 2)}\n`, message, sha })) return next;
    }
    throw new HttpError(503, 'الخادم مشغول. حاول مرة أخرى.');
  }

  async appendLog(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), who: 'owner', ...entry });
    for (let attempt = 0; attempt < 4; attempt++) {
      const f = await this.readText('log.jsonl');
      const text = `${f ? f.text : ''}${f && f.text && !f.text.endsWith('\n') ? '\n' : ''}${line}\n`;
      if (await this.gh.putText({ branch: STATE_BRANCH, path: 'log.jsonl', text, message: `log: ${entry.action}`, sha: f ? f.sha : null })) return;
    }
    throw new HttpError(503, 'تعذّر تسجيل العملية. حاول مرة أخرى.');
  }

  async readLog(limit = 200) {
    const f = await this.readText('log.jsonl');
    if (!f) return [];
    const out = [];
    for (const line of f.text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* a damaged line is skipped, the rest still shown */ }
    }
    return out.slice(-limit).reverse();
  }
}

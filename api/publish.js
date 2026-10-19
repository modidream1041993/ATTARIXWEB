// POST /api/publish → records main's current commit in the publish history, then merges site/preview into main
// (a normal merge commit through GitHub's merges API — never a force push). Vercel then deploys main.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, MAIN, PREVIEW, CONTENT_PATH } from './_lib/site-repo.js';
import { changedPaths } from '../site-build/lib/schema.mjs';

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  await readJson(req, 1024);
  if (!(await gh.getRef(PREVIEW))) throw new HttpError(409, 'لا توجد معاينة محفوظة للنشر');
  const previewTip = await ensurePreview(gh);
  const mainBefore = await gh.getRef(MAIN);
  const [p, m] = await Promise.all([gh.getCommit(previewTip), gh.getCommit(mainBefore)]);
  if (p.tree.sha === m.tree.sha) throw new HttpError(409, 'لا يوجد جديد للنشر — المعاينة مطابقة للموقع المنشور');

  let summary = [];
  try {
    const [a, b] = await Promise.all([gh.getText(CONTENT_PATH, mainBefore), gh.getText(CONTENT_PATH, previewTip)]);
    if (a && b) summary = changedPaths(JSON.parse(a.text), JSON.parse(b.text));
  } catch { summary = []; }

  const id = `${Date.now()}`;
  await store.updateJson('publish-history.json', [], (h) => [...h, { id, at: new Date().toISOString(), mainBefore, previewTip, status: 'pending' }], 'publish: start');
  const r = await gh.merge(MAIN, PREVIEW, 'نشر من لوحة التحكم (site/preview → main)');
  await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === id ? { ...e, status: r.merged ? 'done' : 'empty', mergeSha: r.sha || null } : e)), 'publish: done');
  if (!r.merged) throw new HttpError(409, 'لا يوجد جديد للنشر');
  const what = summary.length ? summary.slice(0, 20).join('، ') : 'الشعار أو ملفات أخرى';
  await store.appendLog({ action: 'publish', summary: `نشر — ${what}`, mainBefore: mainBefore.slice(0, 12), mergeSha: r.sha.slice(0, 12) });
  send(res, 200, { ok: true, mergeSha: r.sha });
});

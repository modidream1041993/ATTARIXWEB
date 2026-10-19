// POST /api/publish («نشر») → copies ONLY the content and brand files (content/site.json, brand/*) from site/preview
// onto main, as ONE plain commit on top of main (fast-forward, never a force push, never a merge). site/preview may
// carry the panel's own code (api/, admin/); a merge would take it to the public site, so nothing but the managed
// files ever leaves site/preview. main's commit before the publish is recorded first, for «تراجع». Vercel then
// deploys main. Refused while main is not yet built from content/site.json (site/public not merged).
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, restoreEntries, MAIN, PREVIEW, CONTENT_PATH, BUILD_PATH } from './_lib/site-repo.js';
import { changedPaths } from '../site-build/lib/schema.mjs';

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  await readJson(req, 1024);
  if (!(await gh.getRef(PREVIEW))) throw new HttpError(409, 'لا توجد معاينة محفوظة للنشر');
  const mainNow = await gh.getRef(MAIN);
  if (!mainNow) throw new HttpError(502, 'الفرع الرئيسي غير موجود');
  if (!(await gh.treeMap(mainNow)).map.has(BUILD_PATH)) {
    throw new HttpError(409, 'الموقع المنشور لا يُبنى من ملف المحتوى بعد — لا يمكن النشر من اللوحة قبل اعتماد ذلك.');
  }
  const previewTip = await ensurePreview(gh);
  const desired = (await gh.treeMap(previewTip)).map;
  if (!desired.has(CONTENT_PATH)) throw new HttpError(409, 'المعاينة لا تحتوي ملف المحتوى');

  let id = null;
  let mainBefore = null;
  let newMain = null;
  let published = [];
  for (let attempt = 0; attempt < 3 && !newMain; attempt++) {
    const tip = await gh.getRef(MAIN);
    const entries = restoreEntries(desired, (await gh.treeMap(tip)).map);
    if (!entries.length) {
      if (id) await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === id ? { ...e, status: 'empty' } : e)), 'publish: nothing new');
      throw new HttpError(409, 'لا يوجد جديد للنشر — المعاينة مطابقة للموقع المنشور');
    }
    if (!id) {
      id = `${Date.now()}`;
      await store.updateJson('publish-history.json', [], (h) => [...h, { id, at: new Date().toISOString(), mainBefore: tip, previewTip, status: 'pending' }], 'publish: start');
    } else {
      await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === id ? { ...e, mainBefore: tip } : e)), 'publish: main moved');
    }
    const sha = await gh.commitTree({ parentSha: tip, entries, message: 'نشر من لوحة التحكم: المحتوى والشعار فقط (site/preview → main)' });
    if (await gh.fastForward(MAIN, sha)) { newMain = sha; mainBefore = tip; published = entries.map((e) => e.path); }
  }
  if (!newMain) {
    await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === id ? { ...e, status: 'failed' } : e)), 'publish: failed');
    throw new HttpError(409, 'تغيّر الموقع أثناء النشر. حاول مرة أخرى.');
  }
  await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === id ? { ...e, status: 'done', mergeSha: newMain } : e)), 'publish: done');

  let summary = [];
  try {
    const [a, b] = await Promise.all([gh.getText(CONTENT_PATH, mainBefore), gh.getText(CONTENT_PATH, previewTip)]);
    if (a && b) summary = changedPaths(JSON.parse(a.text), JSON.parse(b.text));
  } catch { summary = []; }
  const what = summary.length ? summary.slice(0, 20).join('، ') : published.join('، ');
  await store.appendLog({ action: 'publish', summary: `نشر — ${what}`, mainBefore: mainBefore.slice(0, 12), mergeSha: newMain.slice(0, 12) });
  send(res, 200, { ok: true, mergeSha: newMain, files: published });
});

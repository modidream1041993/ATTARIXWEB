// POST /api/rollback («تراجع») → undoes the most recent publish not yet undone: a NEW commit on main (never a force
// push) whose content/site.json and brand files equal those of the commit recorded before that publish — ONLY those
// files (restoreEntries keeps to the managed paths), so main's own pages and code are never touched. site/preview
// is brought to the same state (fast-forward when it can, else a restoring commit on it). Pressed again, it undoes
// the publish before that one.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { restoreEntries, MAIN, PREVIEW, CONTENT_PATH } from './_lib/site-repo.js';

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  await readJson(req, 1024);
  const { data: history } = await store.readJson('publish-history.json', []);
  const target = [...history].reverse().find((e) => e.status === 'done' && !e.rolledBack);
  if (!target) throw new HttpError(409, 'لا يوجد نشر سابق للتراجع عنه');
  const desired = (await gh.treeMap(target.mainBefore)).map;
  if (!desired.has(CONTENT_PATH)) throw new HttpError(409, 'النسخة السابقة لا تحتوي ملف المحتوى — لا يمكن التراجع إليها من اللوحة');

  let newMain = null;
  let restored = [];
  for (let attempt = 0; attempt < 3 && !newMain; attempt++) {
    const tip = await gh.getRef(MAIN);
    const entries = restoreEntries(desired, (await gh.treeMap(tip)).map);
    restored = entries.map((e) => e.path);
    if (!entries.length) { newMain = tip; break; }
    const sha = await gh.commitTree({ parentSha: tip, entries, message: `تراجع: المحتوى والشعار كما كانا قبل نشر ${target.at}` });
    if (await gh.fastForward(MAIN, sha)) newMain = sha;
  }
  if (!newMain) throw new HttpError(409, 'تغيّر الموقع أثناء التراجع. حاول مرة أخرى.');

  const previewTip = await gh.getRef(PREVIEW);
  if (!previewTip) await gh.createRef(PREVIEW, newMain);
  else if (!(await gh.fastForward(PREVIEW, newMain))) {
    const entries = restoreEntries(desired, (await gh.treeMap(previewTip)).map);
    if (entries.length) await gh.commitOnBranch({ branch: PREVIEW, entries, message: 'تراجع: المعاينة مثل الموقع بعد التراجع' });
  }

  await store.updateJson('publish-history.json', [], (h) => h.map((e) => (e.id === target.id ? { ...e, rolledBack: true, rollbackSha: newMain, rolledBackAt: new Date().toISOString() } : e)), 'rollback');
  await store.appendLog({ action: 'rollback', summary: `تراجع عن نشر ${target.at} — ${restored.length ? restored.join('، ') : 'لا فرق في الملفات'}`, restoredTo: target.mainBefore.slice(0, 12) });
  send(res, 200, { ok: true, restored, commit: newMain });
});

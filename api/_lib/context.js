// What every authenticated endpoint starts with: the method, same-origin JSON for writes, a valid session, and
// the GitHub client + state store built from the environment.
import { assertMethod, assertSameOriginJson, HttpError } from './http.js';
import { requireSession } from './session.js';
import { githubFromEnv } from './github.js';
import { StateStore } from './state.js';

export function adminContext(req, method, env = process.env) {
  assertMethod(req, method);
  if (method !== 'GET') assertSameOriginJson(req);
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(500, 'الخادم غير مُعدّ');
  requireSession(req, secret);
  const gh = githubFromEnv(env);
  return { gh, store: new StateStore(gh) };
}

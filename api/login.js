// POST /api/login {password, totp} → sets the session cookie.
// Password: PBKDF2-SHA256 against ADMIN_PASSWORD_HASH. Code: TOTP (RFC 6238) against ADMIN_TOTP_SECRET, ±1 step,
// each code accepted once. 5 wrong attempts in a row lock the login for 15 minutes (state on the admin-state branch).
import { handler, send, assertMethod, assertSameOriginJson, readJson, HttpError } from './_lib/http.js';
import { parseHash, verifyPassword } from './_lib/password.js';
import { verifyTotp } from './_lib/totp.js';
import { createToken, sessionCookie } from './_lib/session.js';
import { githubFromEnv } from './_lib/github.js';
import { StateStore } from './_lib/state.js';
import { attemptLogin } from './_lib/lockout.js';

export default handler(async (req, res) => {
  assertMethod(req, 'POST');
  assertSameOriginJson(req);
  const body = await readJson(req, 2048);
  const { password, totp } = body;
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || typeof totp !== 'string' || !/^\d{6}$/.test(totp)) {
    throw new HttpError(400, 'اكتب كلمة السر والكود المكوّن من 6 أرقام');
  }
  const env = process.env;
  if (!parseHash(env.ADMIN_PASSWORD_HASH) || !env.ADMIN_TOTP_SECRET || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    throw new HttpError(500, 'الخادم غير مُعدّ');
  }
  const store = new StateStore(githubFromEnv(env));
  const r = await attemptLogin({
    store,
    verify: async () => {
      // Both checks always run, so the time taken says nothing about which one failed.
      const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
      const step = verifyTotp(env.ADMIN_TOTP_SECRET, totp);
      return { ok: passwordOk && step >= 0, step };
    },
  });
  if (r.result === 'locked') {
    if (r.justLocked) {
      try { await store.appendLog({ action: 'login-locked', summary: '5 محاولات دخول خاطئة متتالية — قُفل الدخول 15 دقيقة' }); }
      catch { console.error('admin-api: could not log a lockout'); }
    }
    const minutes = Math.max(1, Math.ceil(r.retryAfterMs / 60000));
    throw new HttpError(429, `محاولات خاطئة كثيرة. الدخول مقفول — جرّب بعد ${minutes} دقيقة.`, { public: { retryAfterMinutes: minutes } });
  }
  if (r.result !== 'ok') throw new HttpError(401, 'كلمة السر أو الكود غير صحيح');
  try { await store.appendLog({ action: 'login', summary: 'تسجيل دخول' }); }
  catch { console.error('admin-api: could not log a login'); }
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createToken(env.ADMIN_SESSION_SECRET)) });
});

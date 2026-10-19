// The login lockout: 5 wrong attempts in a row lock the login for 15 minutes. The counter lives in the state store
// (admin-state branch), so it survives across serverless invocations and instances. While locked, NOTHING is
// checked — not even a correct password — so the lock cannot be used as an oracle.
//
// One admin, so one global counter (no IP is used for anything). The cost, said plainly: someone who keeps sending
// wrong passwords keeps the owner locked out too. The password + the 6-digit code still have to be guessed together.
//
// A TOTP code is accepted once: the step it matched is stored, and a code of that step or an earlier one is refused.

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const FALLBACK = { failures: 0, lockedUntil: 0, lastTotpStep: 0 };

export const isLocked = (s, now) => Number(s.lockedUntil || 0) > now;

export function afterFailure(s, now) {
  if (isLocked(s, now)) return s;
  const failures = Number(s.failures || 0) + 1;
  if (failures >= MAX_FAILURES) return { ...s, failures: 0, lockedUntil: now + LOCK_MS };
  return { ...s, failures, lockedUntil: 0 };
}

export function afterSuccess(s, step) {
  return { ...s, failures: 0, lockedUntil: 0, lastTotpStep: Math.max(Number(s.lastTotpStep || 0), step) };
}

// verify(lastTotpStep) → { ok: boolean, step?: number }. Returns { result: 'ok' | 'wrong' | 'locked', retryAfterMs? }.
// Fail closed: if the state cannot be read or written, the caller gets an error, never a login.
export async function attemptLogin({ store, now = Date.now(), verify }) {
  const { data } = await store.readJson('lockout.json', FALLBACK);
  if (isLocked(data, now)) return { result: 'locked', retryAfterMs: data.lockedUntil - now };
  const v = await verify(Number(data.lastTotpStep || 0));
  if (v.ok && v.step > Number(data.lastTotpStep || 0)) {
    let replay = false;
    await store.updateJson('lockout.json', FALLBACK, (s) => {
      if (isLocked(s, now) || v.step <= Number(s.lastTotpStep || 0)) { replay = true; return undefined; }
      return afterSuccess(s, v.step);
    }, 'lockout: login');
    if (!replay) return { result: 'ok' };
  }
  let locked = false;
  const next = await store.updateJson('lockout.json', FALLBACK, (s) => {
    const n = afterFailure(s, now);
    locked = isLocked(n, now);
    return n;
  }, 'lockout: failed attempt');
  return locked ? { result: 'locked', retryAfterMs: next.lockedUntil - now, justLocked: true } : { result: 'wrong' };
}

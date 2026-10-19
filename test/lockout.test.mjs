// The login lockout, with its state persisted on the (faked) admin-state branch — so it survives across separate
// "serverless invocations" (separate StateStore objects sharing only the repository).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './helpers/fake-github.mjs';
import { GitHub } from '../api/_lib/github.js';
import { StateStore, STATE_BRANCH } from '../api/_lib/state.js';
import { attemptLogin, afterFailure, isLocked, MAX_FAILURES, LOCK_MS } from '../api/_lib/lockout.js';

function freshInvocation(fake) {
  return new StateStore(new GitHub({ token: 't', repo: 'o/r', fetchImpl: fake.fetch }));
}
const wrong = async () => ({ ok: false, step: -1 });
const right = (step) => async () => ({ ok: true, step });

test('pure rules: the 5th consecutive failure locks for 15 minutes', () => {
  let s = { failures: 0, lockedUntil: 0, lastTotpStep: 0 };
  for (let i = 1; i < MAX_FAILURES; i++) { s = afterFailure(s, 1000); assert.equal(isLocked(s, 1000), false); }
  s = afterFailure(s, 1000);
  assert.equal(isLocked(s, 1000), true);
  assert.equal(s.lockedUntil, 1000 + LOCK_MS);
  assert.equal(isLocked(s, 1000 + LOCK_MS), false);
});

test('5 wrong attempts across 5 separate invocations lock the login; the counter persists', async () => {
  const fake = new FakeGitHub();
  const now = 1_800_000_000_000;
  for (let i = 1; i < MAX_FAILURES; i++) {
    const r = await attemptLogin({ store: freshInvocation(fake), now, verify: wrong });
    assert.equal(r.result, 'wrong', `attempt ${i}`);
  }
  const fifth = await attemptLogin({ store: freshInvocation(fake), now, verify: wrong });
  assert.equal(fifth.result, 'locked');
  assert.equal(fifth.justLocked, true);
  assert.ok(fake.refs.has(STATE_BRANCH), 'the state lives on its own branch');
  const state = JSON.parse(fake.textAt(STATE_BRANCH, 'lockout.json'));
  assert.equal(state.lockedUntil, now + LOCK_MS);
  // admin-state is an orphan branch with deployments turned off.
  const first = [...fake.commits.values()].find((c) => c.message === 'admin-state: start');
  assert.deepEqual(first.parents, []);
  assert.deepEqual(JSON.parse(fake.textAt(STATE_BRANCH, 'vercel.json')), { git: { deploymentEnabled: false } });
});

test('while locked, even the right password + code is refused, and nothing is verified', async () => {
  const fake = new FakeGitHub();
  const now = 1_800_000_000_000;
  for (let i = 0; i < MAX_FAILURES; i++) await attemptLogin({ store: freshInvocation(fake), now, verify: wrong });
  let called = false;
  const r = await attemptLogin({ store: freshInvocation(fake), now: now + LOCK_MS - 1, verify: async () => { called = true; return { ok: true, step: 99 }; } });
  assert.equal(r.result, 'locked');
  assert.equal(called, false);
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= LOCK_MS);
  const after = await attemptLogin({ store: freshInvocation(fake), now: now + LOCK_MS, verify: right(1000) });
  assert.equal(after.result, 'ok', 'after 15 minutes the right credentials work again');
});

test('a success resets the counter; a code (TOTP step) is accepted only once', async () => {
  const fake = new FakeGitHub();
  const now = 1_800_000_000_000;
  for (let i = 0; i < MAX_FAILURES - 1; i++) await attemptLogin({ store: freshInvocation(fake), now, verify: wrong });
  assert.equal((await attemptLogin({ store: freshInvocation(fake), now, verify: right(500) })).result, 'ok');
  assert.equal(JSON.parse(fake.textAt(STATE_BRANCH, 'lockout.json')).failures, 0);
  // The same code again (same step) — a replay — is refused and counts as a failure.
  assert.equal((await attemptLogin({ store: freshInvocation(fake), now, verify: right(500) })).result, 'wrong');
  assert.equal((await attemptLogin({ store: freshInvocation(fake), now, verify: right(499) })).result, 'wrong');
  assert.equal((await attemptLogin({ store: freshInvocation(fake), now, verify: right(501) })).result, 'ok');
});

test('fail closed: if the state store cannot be reached, there is no login', async () => {
  const broken = new StateStore(new GitHub({ token: 't', repo: 'o/r', fetchImpl: async () => ({ status: 500, json: async () => ({}) }) }));
  await assert.rejects(() => attemptLogin({ store: broken, now: 1, verify: right(5) }), (e) => e.status === 502);
});

test('the change log is append-only JSON lines, newest first when read', async () => {
  const fake = new FakeGitHub();
  const a = freshInvocation(fake);
  await a.appendLog({ action: 'save', summary: 'one' });
  await freshInvocation(fake).appendLog({ action: 'publish', summary: 'two' });
  const text = fake.textAt(STATE_BRANCH, 'log.jsonl');
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.summary), ['one', 'two']);
  assert.ok(lines.every((l) => l.who === 'owner' && !Number.isNaN(Date.parse(l.at))));
  assert.deepEqual((await freshInvocation(fake).readLog()).map((l) => l.summary), ['two', 'one']);
});

// The owner runs this ONCE on his own PC to make the admin panel's secrets:
//
//     node site-build/admin-setup.mjs
//
// It asks for the admin password twice (typed hidden), then writes into %USERPROFILE%\ATTARIX-SECRETS\site-admin\ :
//   vercel-env.txt   ADMIN_PASSWORD_HASH, ADMIN_TOTP_SECRET, ADMIN_SESSION_SECRET — to paste into Vercel
//   totp-qr.html     the QR code for Google Authenticator (made here, offline) — DELETE it after scanning
// It refuses to overwrite either file, prints only the folder and the next steps (never a secret), and on Windows
// limits the folder to the current user (icacls, inheritance removed), as the other ATTARIX-SECRETS folders are.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../api/_lib/password.js';
import { base32Encode, otpauthUri } from '../api/_lib/totp.js';

const require = createRequire(import.meta.url);

export const MIN_PASSWORD = 12;

// Pure: everything the files hold, from a password. (Tested; the CLI below only adds the prompts and the writes.)
export async function makeSecrets(password, { random = randomBytes } = {}) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD) throw new Error(`password shorter than ${MIN_PASSWORD}`);
  const totpSecret = base32Encode(random(20));
  const sessionSecret = random(32).toString('base64url');
  const passwordHash = await hashPassword(password);
  const envText = [
    '# ATTARIX site admin — Vercel environment variables (Production AND Preview).',
    '# Keep this file here only. Never paste it in a chat, never commit it.',
    `ADMIN_PASSWORD_HASH=${passwordHash}`,
    `ADMIN_TOTP_SECRET=${totpSecret}`,
    `ADMIN_SESSION_SECRET=${sessionSecret}`,
    '',
  ].join('\n');
  const uri = otpauthUri({ secret: totpSecret, account: 'owner', issuer: 'ATTARIX Admin' });
  return { passwordHash, totpSecret, sessionSecret, envText, uri, qrHtml: qrPage(uri) };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function qrPage(uri) {
  const qrcode = require('./vendor/qrcode-generator/qrcode.cjs');
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>ATTARIX Admin — رمز Google Authenticator</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:560px;margin:30px auto;padding:0 16px;line-height:1.8}
.qr{background:#fff;padding:12px;border:1px solid #ccc;border-radius:12px;max-width:340px}.qr svg{width:100%;height:auto;display:block}
.warn{background:#FEF3F2;color:#B42318;border-radius:10px;padding:10px 14px;font-weight:700}</style></head>
<body>
<h1>رمز الدخول بخطوتين — ATTARIX Admin</h1>
<ol>
<li>افتح تطبيق Google Authenticator على موبايلك ← «+» ← «مسح رمز QR».</li>
<li>امسح الرمز ده. هيظهر حساب باسم «ATTARIX Admin».</li>
<li>جرّب تسجّل دخول في اللوحة بالكود اللي بيظهر.</li>
</ol>
<div class="qr">${svg}</div>
<p class="warn">بعد المسح والتأكد إن الدخول شغّال: امسح الملف ده (totp-qr.html). أي حد يشوفه يقدر يعمل نفس الأكواد.</p>
<p><small>${escapeHtml('مسار الحساب: ATTARIX Admin:owner')}</small></p>
</body></html>
`;
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('run this in a terminal (the password is typed hidden)')); return; }
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0008' || ch === '\u007f') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function lockFolder(dir) {
  if (process.platform !== 'win32') return 'skipped (not Windows)';
  const user = `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${process.env.USERNAME}`;
  try {
    execFileSync('icacls', [dir, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], { stdio: 'ignore' });
    return 'locked to the current Windows user';
  } catch {
    return 'NOT locked — icacls failed; set the folder permissions by hand';
  }
}

async function main() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error('no USERPROFILE');
  const dir = join(home, 'ATTARIX-SECRETS', 'site-admin');
  const envFile = join(dir, 'vercel-env.txt');
  const qrFile = join(dir, 'totp-qr.html');
  if (existsSync(envFile) || existsSync(qrFile)) {
    throw new Error(`${dir} already holds vercel-env.txt or totp-qr.html — refusing to overwrite. Move them away first if you really mean to make new secrets.`);
  }
  console.log('ATTARIX site admin — setup. The password is typed hidden (nothing shows). At least 12 characters.');
  const p1 = await askHidden('Admin password: ');
  const p2 = await askHidden('Again: ');
  if (p1 !== p2) throw new Error('the two passwords differ — nothing written');
  const s = await makeSecrets(p1);
  mkdirSync(dir, { recursive: true });
  const lock = lockFolder(dir);
  writeFileSync(envFile, s.envText, { flag: 'wx' });
  writeFileSync(qrFile, s.qrHtml, { flag: 'wx' });
  console.log(`\nWritten to: ${dir}`);
  console.log(`Folder permissions: ${lock}`);
  console.log('Next (docs/ADMIN-SETUP-AR.md):');
  console.log('  1. Open totp-qr.html in a browser and scan it with Google Authenticator.');
  console.log('  2. Paste the three lines of vercel-env.txt into Vercel → Settings → Environment Variables (Production and Preview).');
  console.log('  3. After the first successful login, delete totp-qr.html.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`setup failed: ${e.message}`); process.exit(1); });
}

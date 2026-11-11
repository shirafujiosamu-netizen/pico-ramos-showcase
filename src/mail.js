// Pico RamOS mail aggregation - fetches recent messages from the user's IMAP
// accounts (Gmail / QQ / 163 / custom) in the main process and returns a
// normalized list the mail card can render. Each account is fetched
// independently so one bad password or timeout never blanks the others.
//
// Credentials (email + app-password / auth-code) are stored ONLY in cards.json
// on this machine - nothing leaves the device except the IMAP connection the
// user explicitly configured.
'use strict';
const Imap = require('node-imap');
const { simpleParser } = require('mailparser');

const PROVIDERS = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true, label: 'Gmail' },
  qq: { host: 'imap.qq.com', port: 993, secure: true, label: 'QQ 邮箱' },
  netease163: { host: 'imap.163.com', port: 993, secure: true, label: '163 邮箱' },
  custom: { host: '', port: 993, secure: true, label: '自定义' },
};

/* Teardown that cannot crash. node-imap's own destroy() sets
 * this._curReq = undefined AND only half-closes the socket (sock.end()) -
 * server data still in flight then reaches parser handlers that read
 * self._curReq.type and throw an UNCAUGHT TypeError (field crash: the mail
 * card flipped into its error state right after a successful fetch). Keep the
 * field non-null and ABORT the socket instead, so no further parser events
 * can fire at all. */
function teardown(imap) {
  try { imap._queue = []; } catch (e) {}
  try { if (!imap._curReq) imap._curReq = { type: 'NOOP', fullcmd: 'NOOP' }; } catch (e) {}
  try { if (imap._sock) imap._sock.destroy(); } catch (e) {}
}

function fetchAccount(acc, limit) {
  return new Promise((resolve) => {
    const prov = PROVIDERS[acc.provider] || PROVIDERS.custom;
    const host = (acc.host || prov.host || '').trim();
    const user = (acc.user || '').trim();
    const password = acc.password || '';
    if (!host || !user || !password) {
      return resolve({ account: acc.label || user || '(未配置)', error: 'incomplete' });
    }
    const imap = new Imap({
      user: user, password: password,
      host: host, port: Number(acc.port) || prov.port || 993,
      tls: acc.secure !== false,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 12000, authTimeout: 12000,
    });
    const out = [];
    let settled = false;
    const finish = (err) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      teardown(imap);
      if (err) resolve({ account: acc.label || user, error: String((err && err.message) || err) });
      else resolve({ account: acc.label || user, messages: out });
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 16000);
    imap.once('error', (e) => { clearTimeout(timer); finish(e); });
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { clearTimeout(timer); return finish(err); }
        const total = imap._box ? imap._box.messages.total : 0;
        const max = Math.min(limit || 12, total || 0);
        if (max <= 0) { clearTimeout(timer); return finish(null); }
        const range = (total - max + 1) + ':' + total;
        let pending = max;
        const seen = new Set();
        const f = imap.seq.fetch(range, { bodies: '', struct: true });
        f.on('message', (msg) => {
          let buf = '';
          let attrs = null;
          msg.on('body', (stream) => { stream.on('data', (d) => { buf += d.toString('utf8'); }); });
          msg.once('attributes', (a) => { attrs = a; });
          msg.once('end', () => {
            simpleParser(buf).then((parsed) => {
              const uid = attrs && attrs.uid;
              if (uid != null && seen.has(uid)) return;
              if (uid != null) seen.add(uid);
              out.push({
                uid: uid,
                // node-imap attributes.flags carries \Seen; anything without it
                // is unread (also true when the server never reports flags)
                unread: !(attrs && Array.isArray(attrs.flags) && attrs.flags.indexOf('\\Seen') >= 0),
                from: parsed.from && parsed.from.text ? parsed.from.text : '(未知发件人)',
                subject: parsed.subject || '(无主题)',
                date: parsed.date ? parsed.date.toISOString() : null,
                preview: (parsed.text || (parsed.html ? parsed.html.toString() : '') || '')
                  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
              });
            }).catch(() => {}).then(() => {
              pending--;
              if (pending <= 0) { clearTimeout(timer); finish(null); }
            });
          });
        });
        f.once('error', (e) => { clearTimeout(timer); finish(e); });
        f.once('end', () => { if (pending <= 0) { clearTimeout(timer); finish(null); } });
      });
    });
    try { imap.connect(); } catch (e) { clearTimeout(timer); finish(e); }
  });
}

async function fetchAll(accounts, limit) {
  const list = Array.isArray(accounts) ? accounts : [];
  const results = await Promise.all(list.map((a) => fetchAccount(a, limit)));
  return results;
}

/* ---------------------------------------------------------------------------
 * SMTP send. Same credentials shape as the IMAP side: {provider, host, port,
 * secure, user, password}. QQ / 163 require an app-specific auth code, not the
 * account password, and QQ rejects a From that does not match the login user.
 * ------------------------------------------------------------------------- */
const nodemailer = require('nodemailer');

const SMTP = {
  gmail:     { host: 'smtp.gmail.com',  port: 465, secure: true },
  qq:        { host: 'smtp.qq.com',     port: 465, secure: true },
  netease163:{ host: 'smtp.163.com',    port: 465, secure: true },
  custom:    { host: '',                port: 465, secure: true },
};

async function sendMail(acc, msg) {
  const prov = SMTP[acc.provider] || SMTP.custom;
  const host = (acc.smtpHost || acc.host || prov.host || '').trim();
  const user = (acc.user || '').trim();
  const pass = acc.password || '';
  if (!host || !user || !pass) {
    const err = new Error('SMTP 未配置完整（需要服务器、账号、授权码）');
    err.code = 'INCOMPLETE';
    throw err;
  }
  const transport = nodemailer.createTransport({
    host: host.replace(/^imap\./, 'smtp.'),
    port: Number(acc.smtpPort || prov.port),
    secure: acc.smtpSecure == null ? prov.secure : !!acc.smtpSecure,
    auth: { user: user, pass: pass },
  });
  const info = await transport.sendMail({
    from: acc.from || user,
    to: msg.to,
    cc: msg.cc || undefined,
    bcc: msg.bcc || undefined,
    subject: msg.subject || '(无主题)',
    text: msg.text || '',
    html: msg.html || undefined,
  });
  try { transport.close(); } catch (e) {}
  return { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

module.exports = { fetchAll, sendMail, PROVIDERS, SMTP };

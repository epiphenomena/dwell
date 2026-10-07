// Sending sign-in email. Over SMTP with implicit TLS (port 465, as
// DreamHost's smtp.dreamhost.com offers) on a Workers TCP socket; or, in
// local development (DEV_MAIL=log), written to the console instead.
//
// Settings (vars or secrets): SMTP_HOST, SMTP_PORT (465), SMTP_USER,
// SMTP_PASS, MAIL_FROM ("Dwell <dwell@literal.work>"). SMTP_TLS=off is for
// testing against a plain local server only.
import { connect } from 'cloudflare:sockets';

export const mailConfigured = env => env.DEV_MAIL === 'log' || !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);

export async function sendMail(env, { to, subject, text, html }) {
  if (env.DEV_MAIL === 'log') {
    console.log(`[mail] to ${to}: ${subject}\n${text}`);
    return;
  }
  await smtp({
    host: env.SMTP_HOST,
    port: +(env.SMTP_PORT || 465),
    tls: env.SMTP_TLS !== 'off',
    user: (env.SMTP_USER || '').trim(),
    pass: (env.SMTP_PASS || '').replace(/^[\r\n]+|[\r\n]+$/g, ''),
    from: env.MAIL_FROM,
    to, subject, text, html,
  });
}

const enc = new TextEncoder();
const b64 = s => {
  let bin = '';
  for (const byte of enc.encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
};
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
const header = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const address = s => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();

function message({ from, to, subject, text, html, host }) {
  const boundary = `b${crypto.randomUUID()}`;
  const name = /^(.*?)\s*</.exec(from)?.[1];
  return [
    `From: ${name ? `${header(name)} <${address(from)}>` : address(from)}`,
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${address(from).split('@')[1] || host}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function smtp({ host, port, tls, user, pass, from, to, subject, text, html }) {
  const socket = connect({ hostname: host, port }, { secureTransport: tls ? 'on' : 'off' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const dec = new TextDecoder();
  let buf = '';

  // One reply, which may span lines ("250-..." continues, "250 ..." ends it).
  async function reply() {
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3}( |$)/.test(lines[i])) {
          buf = lines.slice(i + 1).join('\r\n');
          return { code: +lines[i].slice(0, 3), text: lines.slice(0, i + 1).join(' | ') };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed');
      buf += dec.decode(value, { stream: true });
    }
  }
  const say = line => writer.write(enc.encode(`${line}\r\n`));
  const expect = async (...codes) => {
    const r = await reply();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${r.text}`);
    return r;
  };

  try {
    await expect(220);
    await say(`EHLO ${address(from).split('@')[1] || 'localhost'}`);
    await expect(250);
    await say(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`);
    // Refused: say which login was tried (never the password, only its length).
    await expect(235).catch(e => { throw new Error(`${e.message} (user ${JSON.stringify(user)}, password ${pass.length} chars)`); });
    await say(`MAIL FROM:<${address(from)}>`);
    await expect(250);
    await say(`RCPT TO:<${to}>`);
    await expect(250, 251);
    await say('DATA');
    await expect(354);
    // Base64 bodies and plain headers: no line can start with a dot.
    await writer.write(enc.encode(`${message({ from, to, subject, text, html, host })}\r\n.\r\n`));
    await expect(250);
    await say('QUIT');
    await reply().catch(() => {});
  } finally {
    await socket.close().catch(() => {});
  }
}

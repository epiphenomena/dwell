// Try a DreamHost SMTP login the way the Worker does (implicit TLS on 465,
// AUTH PLAIN), to tell bad credentials from a bug. Prompts for the mailbox
// and password (not echoed); prints only the server's answer. Sends no mail.
// Run it yourself:  node tools/smtp-check.mjs
import tls from 'node:tls';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = s => { if (!muted) write(s); };
const lines = rl[Symbol.asyncIterator]();
const ask = async (q, hidden) => {
  process.stdout.write(q);
  muted = hidden;
  const { value = '' } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return value;
};

const user = await ask('Mailbox (SMTP_USER, e.g. dwell@literal.work): ');
const pass = await ask('Password (SMTP_PASS, not shown): ', true);
rl.close();
console.log(`user is ${JSON.stringify(user)} (${user.length} chars); password is ${pass.length} chars${/^\s|\s$/.test(pass) ? ', with leading/trailing spaces' : ''}`);

const sock = tls.connect(465, 'smtp.dreamhost.com', { servername: 'smtp.dreamhost.com' });
let buf = '';
const reply = () => new Promise(resolve => {
  const check = () => {
    const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(buf);
    if (m) { const line = buf.slice(0, m.index + m[0].length); buf = buf.slice(m.index + m[0].length); sock.off('data', on); resolve(line.trim().split('\r\n').pop()); }
  };
  const on = d => { buf += d; check(); };
  sock.on('data', on); check();
});
const say = l => sock.write(`${l}\r\n`);

console.log(await reply());
say('EHLO literal.work'); await reply();
say(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`);
const r = await reply();
console.log(r.startsWith('235') ? `OK: ${r}` : `FAILED: ${r}`);
say('QUIT'); sock.end();

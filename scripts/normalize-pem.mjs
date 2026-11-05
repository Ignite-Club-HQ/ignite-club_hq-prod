// Rebuilds a clean PEM from PEM_IN even when the secret was pasted on one line
// (newlines turned into spaces or literal \n). Writes the PEM to stdout.
const s = (process.env.PEM_IN || '').replace(/\r/g, '').replace(/\\n/g, '\n');
const m = s.match(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
if (!m) { console.error('Key secret has no BEGIN/END block'); process.exit(1); }
const body = m[2].replace(/\s+/g, '').match(/.{1,64}/g).join('\n');
process.stdout.write(`-----BEGIN ${m[1]}-----\n${body}\n-----END ${m[1]}-----\n`);

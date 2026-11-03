const fs = require('fs');
function parse(file) {
  const out = {}; if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('='); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
// Merge changes into the file, keeping comments and unknown keys.
function write(file, changes) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const left = { ...changes };
  const out = lines.map(line => {
    const i = line.indexOf('='); if (line.trim().startsWith('#') || i < 1) return line;
    const k = line.slice(0, i).trim(); if (k in left) { const v = String(left[k]).replace(/[\r\n]/g, ' '); delete left[k]; return `${k}=${v}`; }
    return line;
  }).filter((l, i, a) => !(l === '' && i === a.length - 1));
  for (const [k, v] of Object.entries(left)) out.push(`${k}=${String(v).replace(/[\r\n]/g, ' ')}`);
  fs.writeFileSync(file, out.join('\n') + '\n');
}
module.exports = { parse, write };

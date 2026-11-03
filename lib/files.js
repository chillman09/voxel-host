const fs = require('fs'), path = require('path');
const fail = (m) => Object.assign(new Error(m), { status: 400 });
// Resolve a user-supplied path inside a server folder; blocks ../ and symlink escapes.
function safe(root, rel = '') {
  const p = path.resolve(root, '.' + path.sep + String(rel).replace(/\\/g, '/'));
  if (p !== root && !p.startsWith(root + path.sep)) throw fail('Invalid path');
  let c = p; while (!fs.existsSync(c) && c !== root) c = path.dirname(c);
  const real = fs.realpathSync(c), rr = fs.realpathSync(root);
  if (real !== rr && !real.startsWith(rr + path.sep)) throw fail('Invalid path');
  return p;
}
function list(root, rel) {
  const dir = safe(root, rel);
  return fs.readdirSync(dir, { withFileTypes: true }).map(d => {
    const st = fs.statSync(path.join(dir, d.name), { throwIfNoEntry: false }) || {};
    return { name: d.name, dir: d.isDirectory(), size: st.size || 0, mtime: st.mtimeMs || 0 };
  }).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
}
function readText(root, rel) {
  const p = safe(root, rel), st = fs.statSync(p);
  if (st.isDirectory()) throw fail('That is a folder');
  if (st.size > 2 * 1024 * 1024) throw fail('File is too large to edit here (2 MB max)');
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) throw fail('Binary files cannot be edited here');
  return buf.toString('utf8');
}
module.exports = { safe, list, readText };

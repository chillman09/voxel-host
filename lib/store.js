const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA, 'servers'), { recursive: true });
const FILE = path.join(DATA, 'db.json');
let db = { users: [], servers: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
const fail = (code, msg) => Object.assign(new Error(msg), { status: code });
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

const limits = () => ({
  maxServers: Number(process.env.MAX_SERVERS_PER_USER || 1),
  maxRam: Number(process.env.MAX_RAM_MB || 1024), minRam: 256,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 300)
});
function portPool() {
  const out = [];
  for (const part of String(process.env.PORT_POOL || '19007').split(',')) {
    const [a, b] = part.trim().split('-').map(Number);
    if (a) for (let p = a; p <= (b || a); p++) out.push(p);
  }
  return out;
}
function createUser(username, password, role = 'user') {
  username = String(username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw fail(400, 'Username must be 3-20 letters, numbers or underscores');
  if (String(password || '').length < 8) throw fail(400, 'Password must be at least 8 characters');
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw fail(409, 'That username is taken');
  const salt = crypto.randomBytes(16).toString('hex');
  db.users.push({ username, salt, hash: hash(password, salt), role, createdAt: Date.now() }); save();
  return { username, role };
}
function verifyUser(username, password) {
  const u = db.users.find(x => x.username.toLowerCase() === String(username || '').toLowerCase());
  const salt = u ? u.salt : 'x'.repeat(32), h = hash(String(password || ''), salt);
  if (!u || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return null;
  return { username: u.username, role: u.role };
}
const hasUser = name => db.users.some(u => u.username.toLowerCase() === name.toLowerCase());
const serverDir = id => path.join(DATA, 'servers', id);
const listServers = owner => db.servers.filter(s => !owner || s.owner === owner);
const getServer = id => db.servers.find(s => s.id === id);
function createServer(owner, name, ramMb) {
  const L = limits(); name = String(name || '').trim().slice(0, 40); ramMb = Math.round(Number(ramMb));
  if (!name) throw fail(400, 'Give the server a name');
  if (!(ramMb >= L.minRam && ramMb <= L.maxRam)) throw fail(400, `RAM must be between ${L.minRam} and ${L.maxRam} MB`);
  if (listServers(owner).length >= L.maxServers) throw fail(403, `You can create up to ${L.maxServers} server(s)`);
  const used = new Set(db.servers.map(s => s.port)), port = portPool().find(p => !used.has(p));
  if (!port) throw fail(409, 'No free ports are available right now');
  const s = { id: crypto.randomBytes(6).toString('hex'), owner, name, ramMb, port, jar: 'server.jar', eula: false, createdAt: Date.now() };
  db.servers.push(s); fs.mkdirSync(serverDir(s.id), { recursive: true }); save(); return s;
}
function updateServer(id, patch) {
  const s = getServer(id), L = limits();
  if (patch.name !== undefined) s.name = String(patch.name).trim().slice(0, 40) || s.name;
  if (patch.ramMb !== undefined) { const r = Math.round(Number(patch.ramMb)); if (!(r >= L.minRam && r <= L.maxRam)) throw fail(400, `RAM must be between ${L.minRam} and ${L.maxRam} MB`); s.ramMb = r; }
  if (patch.jar !== undefined) { const j = path.basename(String(patch.jar)); if (!/^[\w.\-]+\.jar$/.test(j)) throw fail(400, 'Jar file name must end in .jar'); s.jar = j; }
  if (patch.eula !== undefined) s.eula = !!patch.eula;
  save(); return s;
}
function deleteServer(id) {
  db.servers = db.servers.filter(s => s.id !== id); save();
  fs.rmSync(serverDir(id), { recursive: true, force: true });
}
module.exports = { DATA, limits, createUser, verifyUser, hasUser, serverDir, listServers, getServer, createServer, updateServer, deleteServer, fail };

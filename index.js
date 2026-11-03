require('dotenv').config();
const path = require('path'), fs = require('fs'), http = require('http'), crypto = require('crypto');
const express = require('express'), session = require('express-session'), FileStore = require('session-file-store')(session);
const { Server } = require('socket.io');
const store = require('./lib/store'), manager = require('./lib/manager'), files = require('./lib/files'), props = require('./lib/props');

const PORT = Number(process.env.PORT || 3000);
const secretFile = path.join(store.DATA, '.secret');
const SECRET = process.env.SESSION_SECRET || (() => {
  try { return fs.readFileSync(secretFile, 'utf8'); }
  catch { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretFile, s, { mode: 0o600 }); return s; }
})();

// First start: create the admin account.
const ADMIN = process.env.ADMIN_USERNAME || 'admin';
if (!store.hasUser(ADMIN)) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  store.createUser(ADMIN, pw, 'admin');
  console.log(`Admin account created: ${ADMIN} / ${process.env.ADMIN_PASSWORD ? '(password from .env)' : pw}`);
}

const app = express(), httpServer = http.createServer(app), io = new Server(httpServer);
app.set('trust proxy', 1);
const sessionMw = session({
  name: 'voxel.sid', secret: SECRET, resave: false, saveUninitialized: false,
  store: new FileStore({ path: path.join(store.DATA, 'sessions'), ttl: 7 * 86400, logFn: () => {} }),
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 86400 * 1000 }
});
app.use(sessionMw); io.engine.use(sessionMw);
app.use(express.json({ limit: '3mb' }));

const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const needAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Not signed in' });
const owned = (req, res, next) => {
  const s = store.getServer(req.params.id), u = req.session.user;
  if (!s || (s.owner !== u.username && u.role !== 'admin')) return res.status(404).json({ error: 'Server not found' });
  req.srv = s; req.root = store.serverDir(s.id); next();
};
const pub = s => ({ id: s.id, name: s.name, owner: s.owner, port: s.port, ramMb: s.ramMb, jar: s.jar, eula: s.eula, status: manager.status(s.id) });

// ---- auth (rate limited per IP)
const tries = new Map();
const limited = ip => { const n = Date.now(), a = (tries.get(ip) || []).filter(t => n - t < 15 * 60000); tries.set(ip, a); return a.length >= 12; };
const note = ip => tries.set(ip, [...(tries.get(ip) || []), Date.now()]);
function startSession(req, res, user) {
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start session' });
    req.session.user = user; req.session.save(e => e ? res.status(500).json({ error: 'Could not save session' }) : res.json({ user }));
  });
}
app.post('/api/auth/login', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const user = store.verifyUser(req.body?.username, req.body?.password);
  if (!user) { note(req.ip); return res.status(401).json({ error: 'Invalid username or password' }); }
  startSession(req, res, user);
});
app.post('/api/auth/register', (req, res) => {
  if (process.env.ALLOW_SIGNUP === 'false') return res.status(403).json({ error: 'Sign-up is closed' });
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  note(req.ip);
  try { startSession(req, res, store.createUser(req.body?.username, req.body?.password)); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', needAuth, (req, res) => res.json({ user: req.session.user }));
app.get('/api/config', needAuth, (req, res) => {
  const L = store.limits(); res.json({ ...L, host: process.env.PUBLIC_HOST || req.hostname });
});

// ---- servers
app.get('/api/servers', needAuth, (req, res) => {
  const u = req.session.user; res.json({ servers: store.listServers(u.role === 'admin' ? null : u.username).map(pub) });
});
app.post('/api/servers', needAuth, wrap((req, res) => res.json({ server: pub(store.createServer(req.session.user.username, req.body?.name, req.body?.ramMb)) })));
app.get('/api/servers/:id', needAuth, owned, (req, res) => res.json({ server: pub(req.srv) }));
app.put('/api/servers/:id/settings', needAuth, owned, wrap((req, res) => {
  if (manager.status(req.srv.id) !== 'offline' && (req.body.ramMb !== undefined || req.body.jar !== undefined)) return res.status(400).json({ error: 'Stop the server before changing RAM or the jar file' });
  res.json({ server: pub(store.updateServer(req.srv.id, req.body || {})) });
}));
app.delete('/api/servers/:id', needAuth, owned, (req, res) => {
  const finish = () => { store.deleteServer(req.srv.id); res.json({ ok: true }); };
  manager.status(req.srv.id) === 'offline' ? finish() : (manager.kill(req.srv.id), setTimeout(finish, 800));
});
app.post('/api/servers/:id/power', needAuth, owned, (req, res) => {
  const a = req.body?.action, id = req.srv.id;
  const r = a === 'start' ? manager.start(req.srv) : a === 'stop' ? manager.stop(id) : a === 'kill' ? manager.kill(id)
    : a === 'restart' ? (manager.status(id) === 'offline' ? manager.start(req.srv) : restart(req.srv)) : { ok: false, error: 'Unknown action' };
  r.ok ? res.json({ ok: true }) : res.status(400).json({ error: r.error });
});
function restart(srv) {
  const onStatus = (id, s) => { if (id === srv.id && s === 'offline') { manager.bus.off('status', onStatus); manager.start(store.getServer(srv.id)); } };
  manager.bus.on('status', onStatus); return manager.stop(srv.id);
}
app.post('/api/servers/:id/command', needAuth, owned, (req, res) => {
  const r = manager.command(req.srv.id, req.body?.command); r.ok ? res.json({ ok: true }) : res.status(400).json({ error: r.error });
});

// ---- files
app.get('/api/servers/:id/files', needAuth, owned, wrap((req, res) => res.json({ path: req.query.path || '', items: files.list(req.root, req.query.path || '') })));
app.get('/api/servers/:id/file', needAuth, owned, wrap((req, res) => res.json({ content: files.readText(req.root, req.query.path) })));
app.put('/api/servers/:id/file', needAuth, owned, wrap((req, res) => {
  const p = files.safe(req.root, req.body?.path); if (typeof req.body?.content !== 'string') throw store.fail(400, 'Missing content');
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, req.body.content); res.json({ ok: true });
}));
app.post('/api/servers/:id/files/mkdir', needAuth, owned, wrap((req, res) => { fs.mkdirSync(files.safe(req.root, req.body?.path), { recursive: true }); res.json({ ok: true }); }));
app.delete('/api/servers/:id/files', needAuth, owned, wrap((req, res) => {
  const p = files.safe(req.root, req.query.path); if (p === req.root) throw store.fail(400, 'Cannot delete the server folder');
  fs.rmSync(p, { recursive: true, force: true }); res.json({ ok: true });
}));
app.get('/api/servers/:id/download', needAuth, owned, wrap((req, res) => {
  const p = files.safe(req.root, req.query.path); if (!fs.statSync(p).isFile()) throw store.fail(400, 'Not a file'); res.download(p);
}));
app.put('/api/servers/:id/upload', needAuth, owned, wrap((req, res) => {
  const name = path.basename(String(req.query.name || '')); if (!name) throw store.fail(400, 'Missing file name');
  const dest = files.safe(req.root, path.join(String(req.query.path || ''), name)), max = store.limits().maxUploadMb * 1048576;
  if (Number(req.headers['content-length'] || 0) > max) return res.status(413).json({ error: `File is larger than ${store.limits().maxUploadMb} MB` });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest); let n = 0, dead = false;
  req.on('data', c => { n += c.length; if (n > max && !dead) { dead = true; req.unpipe(out); out.destroy(); fs.rmSync(dest, { force: true }); res.status(413).json({ error: `File is larger than ${store.limits().maxUploadMb} MB` }); } });
  req.pipe(out); out.on('finish', () => !dead && res.json({ ok: true })); out.on('error', () => !dead && res.status(500).json({ error: 'Upload failed' }));
}));

// ---- server.properties
const propsFile = req => path.join(req.root, 'server.properties');
app.get('/api/servers/:id/properties', needAuth, owned, (req, res) => res.json({ properties: props.parse(propsFile(req)) }));
app.put('/api/servers/:id/properties', needAuth, owned, wrap((req, res) => {
  const ch = { ...(req.body?.properties || {}) }; delete ch['server-port']; delete ch['query.port'];
  props.write(propsFile(req), ch); res.json({ ok: true });
}));

// ---- live console over sockets
io.use((socket, next) => socket.request.session?.user ? next() : next(new Error('unauthorized')));
io.on('connection', socket => {
  socket.on('subscribe', (id, cb) => {
    const s = store.getServer(id), u = socket.request.session.user;
    if (!s || (s.owner !== u.username && u.role !== 'admin')) return cb?.({ ok: false });
    [...socket.rooms].filter(r => r.startsWith('s:')).forEach(r => socket.leave(r)); socket.join('s:' + id);
    socket.emit('history', { id, lines: manager.history(id) }); socket.emit('status', { id, status: manager.status(id) }); cb?.({ ok: true });
  });
});
manager.bus.on('log', (id, line) => io.to('s:' + id).emit('log', { id, line }));
manager.bus.on('status', (id, status) => io.to('s:' + id).emit('status', { id, status }));
manager.bus.on('stats', (id, stats) => io.to('s:' + id).emit('stats', { id, ...stats }));

// ---- pages
app.get('/', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'public', req.session.user ? 'app.html' : 'login.html')); });
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((req, res) => req.path.startsWith('/api') ? res.status(404).json({ error: 'Not found' }) : res.redirect('/'));
app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' }); });

httpServer.listen(PORT, () => console.log(`Voxel Host panel running on port ${PORT}`));
const bye = () => { console.log('Stopping all servers...'); manager.stopAll().then(() => process.exit(0)); setTimeout(() => process.exit(0), 45000).unref(); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
process.on('uncaughtException', e => console.error('Uncaught exception:', e));

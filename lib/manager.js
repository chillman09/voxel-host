const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), EventEmitter = require('events');
const store = require('./store'), props = require('./props');
const bus = new EventEmitter(), run = new Map();
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const get = id => { if (!run.has(id)) run.set(id, { status: 'offline', logs: [], proc: null }); return run.get(id); };
function log(id, line) { const r = get(id); r.logs.push(line); if (r.logs.length > 1000) r.logs.shift(); bus.emit('log', id, line); }
function setStatus(id, s) { get(id).status = s; bus.emit('status', id, s); }
const status = id => get(id).status;
const history = id => get(id).logs;

function start(server) {
  const r = get(server.id);
  if (r.proc) return { ok: false, error: 'Server is already running' };
  const dir = store.serverDir(server.id);
  if (!server.eula) return { ok: false, error: 'Accept the Minecraft EULA in Settings first' };
  if (!fs.existsSync(path.join(dir, server.jar))) return { ok: false, error: `Upload ${server.jar} in the Files tab first` };
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  props.write(path.join(dir, 'server.properties'), { 'server-port': server.port, 'query.port': server.port });
  const args = ['-Xms128M', `-Xmx${server.ramMb}M`, '-jar', server.jar, 'nogui'];
  let proc;
  try { proc = spawn(process.env.JAVA_BIN || 'java', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return { ok: false, error: 'Could not start Java: ' + e.message }; }
  r.proc = proc; r.logs = []; setStatus(server.id, 'starting'); log(server.id, '[panel] Starting server...');
  const feed = buf => { buf.toString('utf8').replace(ANSI, '').split(/\r?\n/).filter(Boolean).forEach(l => { log(server.id, l); if (/Done \(.*\)! For help/.test(l)) setStatus(server.id, 'online'); }); };
  proc.stdout.on('data', feed); proc.stderr.on('data', feed);
  proc.stdin.on('error', () => {});
  proc.on('error', e => { log(server.id, e.code === 'ENOENT' ? '[panel] Java is not installed on this host. Install a JRE (see README).' : '[panel] ' + e.message); r.proc = null; setStatus(server.id, 'offline'); });
  proc.on('exit', code => { clearTimeout(r.killTimer); r.proc = null; log(server.id, `[panel] Server stopped (exit code ${code})`); setStatus(server.id, 'offline'); });
  return { ok: true };
}
function stop(id) {
  const r = get(id); if (!r.proc) return { ok: false, error: 'Server is not running' };
  setStatus(id, 'stopping'); try { r.proc.stdin.write('stop\n'); } catch {}
  r.killTimer = setTimeout(() => r.proc && r.proc.kill('SIGKILL'), 40000); return { ok: true };
}
function kill(id) { const r = get(id); if (!r.proc) return { ok: false, error: 'Server is not running' }; r.proc.kill('SIGKILL'); return { ok: true }; }
function command(id, text) {
  const r = get(id); if (!r.proc) return { ok: false, error: 'Server is not running' };
  const line = String(text).replace(/[\r\n]/g, ' ').trim(); if (!line) return { ok: false, error: 'Type a command' };
  log(id, '> ' + line); r.proc.stdin.write(line + '\n'); return { ok: true };
}
function memMb(id) {
  const p = get(id).proc; if (!p) return null;
  try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p.pid}/status`, 'utf8'))[1]) / 1024); } catch { return null; }
}
setInterval(() => { for (const [id, r] of run) if (r.proc) bus.emit('stats', id, { memMb: memMb(id) }); }, 3000).unref();
function stopAll() { return Promise.all([...run.entries()].filter(([, r]) => r.proc).map(([id, r]) => new Promise(res => { r.proc.once('exit', res); stop(id); }))); }
module.exports = { bus, start, stop, kill, command, status, history, stopAll };

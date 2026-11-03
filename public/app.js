const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, k) => window.toast && window.toast(m, k);
let me, cfg, cur = null, socket = null, srvCache = null, logBox = null;

async function api(url, opt = {}) {
  const r = await fetch(url, { credentials: 'same-origin', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.replace('/'); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const fail = e => toast(e.message, 'error');
function modal(html, cls = '') {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="mbox ${cls}">${html}</div>`;
  m.addEventListener('pointerdown', e => e.target === m && m.remove()); $('#modal-root').appendChild(m); return m;
}
const confirmBox = text => new Promise(res => {
  const m = modal(`<h3>Are you sure?</h3><p class="lede" style="margin:0">${esc(text)}</p><div class="mfoot"><button class="button" id="no">Cancel</button><button class="button button-danger" id="yes">Confirm</button></div>`, 'sm');
  $('#no', m).onclick = () => { m.remove(); res(false); }; $('#yes', m).onclick = () => { m.remove(); res(true); };
});
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const badge = s => `<span class="badge ${s}" id="badge">${s}</span>`;

// ---------- router
function route() {
  const [, kind, id, tab] = location.hash.split('/');
  if (socket && cur && !(kind === 's' && id === cur.id)) { cur = null; }
  (kind === 's' && id ? viewServer(id, tab || 'console') : viewList()).catch(fail);
}
addEventListener('hashchange', route);

// ---------- server list
async function viewList() {
  cur = null; const { servers } = await api('/api/servers');
  $('#view').innerHTML = `<div class="page-head"><div><h1>Your servers</h1><p class="lede" style="margin:8px 0 0">${me.role === 'admin' ? 'Admin view: all customers\' servers.' : 'Create a server, upload a jar and start playing.'}</p></div><button class="button button-primary" id="new">New server <span>+</span></button></div>
  <div class="grid">${servers.map(s => `<div class="panel scard" data-id="${s.id}"><h3>${esc(s.name)} ${badge(s.status).replace(' id="badge"', '')}</h3><div class="meta">${esc(cfg.host)}:${s.port}</div><div class="meta">${s.ramMb} MB RAM${me.role === 'admin' ? ' · owner ' + esc(s.owner) : ''}</div></div>`).join('') || '<p class="empty-route">No servers yet. Press "New server".</p>'}</div>`;
  $('#view').onclick = e => { const c = e.target.closest('.scard'); if (c) location.hash = `#/s/${c.dataset.id}/console`; };
  $('#new').onclick = () => {
    const m = modal(`<div class="mhead"><h3>New server</h3></div><label>Name<input id="nn" maxlength="40" placeholder="My survival world"></label><label>RAM (MB)<input id="nr" type="number" min="${cfg.minRam}" max="${cfg.maxRam}" value="${Math.min(1024, cfg.maxRam)}"></label><p class="form-message" id="nm"></p><div class="mfoot"><button class="button" id="nc">Cancel</button><button class="button button-primary" id="ng">Create</button></div>`, 'sm');
    $('#nc', m).onclick = () => m.remove();
    $('#ng', m).onclick = async () => { try { const { server } = await api('/api/servers', { method: 'POST', body: { name: $('#nn', m).value, ramMb: $('#nr', m).value } }); m.remove(); location.hash = `#/s/${server.id}/files`; toast('Server created. Upload your server jar in Files.', 'ok'); } catch (e) { $('#nm', m).className = 'form-message error'; $('#nm', m).textContent = e.message; } };
  };
}

// ---------- server page
function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on('history', d => { if (cur && d.id === cur.id && logBox) { logBox.innerHTML = ''; d.lines.forEach(addLine); } });
  socket.on('log', d => { if (cur && d.id === cur.id) addLine(d.line); });
  socket.on('status', d => { if (cur && d.id === cur.id) setStatus(d.status); });
  socket.on('stats', d => { if (cur && d.id === cur.id) { const e = $('#mem'); if (e && d.memMb != null) { e.textContent = d.memMb + ' MB'; $('#memfill').style.width = Math.min(100, d.memMb / cur.srv.ramMb * 100) + '%'; } } });
  socket.on('connect', () => cur && socket.emit('subscribe', cur.id));
}
function addLine(line) {
  if (!logBox) return; const near = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 60;
  const d = document.createElement('div'); d.textContent = line;
  d.className = line.startsWith('[panel]') ? 'p' : line.startsWith('> ') ? 'c' : /ERROR|Exception|FATAL/.test(line) ? 'e' : /WARN/.test(line) ? 'w' : '';
  logBox.appendChild(d); while (logBox.childElementCount > 800) logBox.firstChild.remove(); if (near) logBox.scrollTop = logBox.scrollHeight;
}
function setStatus(s) {
  if (!cur) return; cur.srv.status = s; const b = $('#badge'); if (b) { b.className = 'badge ' + s; b.textContent = s; }
  const off = s === 'offline'; [['start', !off], ['stop', off], ['restart', off], ['kill', off]].forEach(([a, dis]) => { const x = $(`[data-power="${a}"]`); if (x) x.disabled = dis; });
  const cmd = $('#cmd'); if (cmd) cmd.disabled = off;
}
async function viewServer(id, tab) {
  const { server } = await api('/api/servers/' + id); const sameServer = cur && cur.id === id;
  cur = { id, srv: server }; connectSocket();
  $('#view').onclick = null;
  $('#view').innerHTML = `<a class="back" href="#/">← All servers</a>
  <div class="sh"><div class="sh-top"><h1>${esc(server.name)} ${badge(server.status)}</h1>
  <div class="power"><button class="button button-primary" data-power="start">Start</button><button class="button" data-power="restart">Restart</button><button class="button" data-power="stop">Stop</button><button class="button button-danger" data-power="kill">Kill</button></div></div>
  <div class="addr">Connect: <b>${esc(cfg.host)}:${server.port}</b> <span>· ${server.ramMb} MB RAM</span></div></div>
  <nav class="vtabs">${[['console', 'Console'], ['files', 'Files'], ['properties', 'Properties'], ['settings', 'Settings']].map(([k, l]) => `<a href="#/s/${id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav><div id="tab"></div>`;
  document.querySelectorAll('[data-power]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/api/servers/${id}/power`, { method: 'POST', body: { action: b.dataset.power } }); } catch (e) { fail(e); } setStatus(cur.srv.status); });
  setStatus(server.status); logBox = null;
  ({ console: tabConsole, files: tabFiles, properties: tabProps, settings: tabSettings }[tab] || tabConsole)(server);
  socket.emit('subscribe', id);
}

function tabConsole() {
  $('#tab').innerHTML = `<div class="stats"><span>Memory <b id="mem">--</b> <span class="bar"><i id="memfill"></i></span></span><span>Limit ${cur.srv.ramMb} MB</span></div><div id="log" aria-live="polite"></div>
  <form class="command-form" id="cf" style="margin-top:12px"><span class="prompt-symbol">›</span><input id="cmd" autocomplete="off" placeholder="Type a command (no slash needed)" ${cur.srv.status === 'offline' ? 'disabled' : ''}><button type="submit">Send ↵</button></form>`;
  logBox = $('#log');
  $('#cf').onsubmit = async e => { e.preventDefault(); const i = $('#cmd'), v = i.value.trim(); if (!v) return; i.value = ''; try { await api(`/api/servers/${cur.id}/command`, { method: 'POST', body: { command: v } }); } catch (er) { fail(er); } };
}

let filePath = '';
function tabFiles() { filePath = ''; loadFiles(''); }
async function loadFiles(p) {
  filePath = p; const { items } = await api(`/api/servers/${cur.id}/files?path=${encodeURIComponent(p)}`);
  const parts = p.split('/').filter(Boolean);
  $('#tab').innerHTML = `<div class="crumbs"><a data-p="">server</a>${parts.map((x, i) => `/ <a data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(x)}</a>`).join(' ')}</div>
  <div class="fbar"><label class="button button-primary" style="margin:0;cursor:pointer">Upload<input type="file" id="up" multiple hidden></label><button class="button" id="mk">New folder</button><button class="button" id="nf">New file</button><span id="upmsg" class="meta"></span></div>
  <div class="panel" style="padding:4px 10px">${items.map(f => `<div class="frow" data-n="${esc(f.name)}" data-d="${f.dir ? 1 : 0}"><span class="n">${f.dir ? '📁 ' : ''}${esc(f.name)}</span><small class="t">${f.dir ? '' : fmtSize(f.size)}</small><div class="acts">${f.dir ? '' : '<button data-a="edit">Edit</button><button data-a="dl">Get</button>'}<button class="del" data-a="rm">Del</button></div></div>`).join('') || '<p class="empty-route" style="padding:14px">This folder is empty.</p>'}</div>`;
  const join = n => (p ? p + '/' : '') + n, base = `/api/servers/${cur.id}`;
  $('#tab').onclick = async e => {
    const c = e.target.closest('[data-p]'); if (c) return loadFiles(c.dataset.p).catch(fail);
    const row = e.target.closest('.frow'); if (!row) return; const name = row.dataset.n, a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (!a) { if (row.dataset.d === '1') return loadFiles(join(name)); return editFile(join(name)); }
      if (a === 'edit') editFile(join(name));
      else if (a === 'dl') location.href = `${base}/download?path=${encodeURIComponent(join(name))}`;
      else if (a === 'rm' && await confirmBox(`Delete "${name}"? This cannot be undone.`)) { await api(`${base}/files?path=${encodeURIComponent(join(name))}`, { method: 'DELETE' }); loadFiles(p); }
    } catch (er) { fail(er); }
  };
  $('#mk').onclick = async () => { const n = prompt('Folder name'); if (n) try { await api(`${base}/files/mkdir`, { method: 'POST', body: { path: join(n) } }); loadFiles(p); } catch (er) { fail(er); } };
  $('#nf').onclick = () => { const n = prompt('File name'); if (n) editFile(join(n), true); };
  $('#up').onchange = e => uploadAll([...e.target.files], p);
}
function uploadAll(list, p) {
  const msg = $('#upmsg'); let i = 0;
  const next = () => {
    if (i >= list.length) { toast('Upload complete', 'ok'); return loadFiles(p); }
    const f = list[i++], x = new XMLHttpRequest();
    x.open('PUT', `/api/servers/${cur.id}/upload?path=${encodeURIComponent(p)}&name=${encodeURIComponent(f.name)}`);
    x.upload.onprogress = e => { if (e.lengthComputable) msg.textContent = `${f.name}: ${Math.round(e.loaded / e.total * 100)}%`; };
    x.onload = () => { if (x.status >= 300) { let m = 'Upload failed'; try { m = JSON.parse(x.responseText).error; } catch {} toast(m, 'error'); } next(); };
    x.onerror = () => { toast('Upload failed', 'error'); next(); }; x.send(f);
  }; next();
}
async function editFile(p, isNew) {
  let text = ''; if (!isNew) try { text = (await api(`/api/servers/${cur.id}/file?path=${encodeURIComponent(p)}`)).content; } catch (e) { return fail(e); }
  const m = modal(`<div class="mhead"><h3>${esc(p)}</h3></div><textarea id="ed" spellcheck="false"></textarea><div class="mfoot"><button class="button" id="c">Close</button><button class="button button-save" id="s">Save</button></div>`);
  $('#ed', m).value = text; $('#c', m).onclick = () => m.remove();
  $('#s', m).onclick = async () => { try { await api(`/api/servers/${cur.id}/file`, { method: 'PUT', body: { path: p, content: $('#ed', m).value } }); toast('Saved', 'ok'); m.remove(); loadFiles(filePath); } catch (e) { fail(e); } };
}

async function tabProps() {
  const { properties } = await api(`/api/servers/${cur.id}/properties`), keys = Object.keys(properties).sort();
  if (!keys.length) { $('#tab').innerHTML = '<div class="panel"><p class="empty-route">No server.properties yet. Start the server once and it will be created here.</p></div>'; return; }
  $('#tab').innerHTML = `<div class="panel"><div class="fbar"><input id="pf" placeholder="Filter settings..." style="max-width:280px"><button class="button button-save" id="ps">Save changes</button></div><div class="pgrid" id="pg">${keys.map(k => {
    const v = properties[k], lock = k === 'server-port' || k === 'query.port';
    return /^(true|false)$/.test(v) ? `<label class="chk" data-k="${esc(k)}"><span>${esc(k)}</span><input type="checkbox" data-k="${esc(k)}" ${v === 'true' ? 'checked' : ''}></label>` : `<label data-k="${esc(k)}">${esc(k)}<input data-k="${esc(k)}" value="${esc(v)}" ${lock ? 'disabled title="Assigned by the panel"' : ''}></label>`;
  }).join('')}</div><p class="note-icon" style="display:none"></p><p class="meta">Restart the server for changes to take effect. The port is assigned by the panel.</p></div>`;
  $('#pf').oninput = e => document.querySelectorAll('#pg [data-k]').forEach(l => { if (l.tagName === 'LABEL') l.style.display = l.dataset.k.includes(e.target.value.toLowerCase()) ? '' : 'none'; });
  $('#ps').onclick = async () => {
    const out = {}; document.querySelectorAll('#pg input').forEach(i => { if (!i.disabled) out[i.dataset.k] = i.type === 'checkbox' ? String(i.checked) : i.value; });
    try { await api(`/api/servers/${cur.id}/properties`, { method: 'PUT', body: { properties: out } }); toast('Saved. Restart to apply.', 'ok'); } catch (e) { fail(e); }
  };
}

function tabSettings(s) {
  $('#tab').innerHTML = `<div class="panel"><form id="sf"><label>Server name<input id="sn" value="${esc(s.name)}" maxlength="40"></label><label>RAM (MB)<input id="sr" type="number" min="${cfg.minRam}" max="${cfg.maxRam}" value="${s.ramMb}"></label><label>Jar file<input id="sj" value="${esc(s.jar)}"></label>
  <label class="chk toggle-row" style="border:2px solid var(--line);padding:11px"><span>I accept the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft EULA</a></span><input type="checkbox" id="se" ${s.eula ? 'checked' : ''}></label>
  <button class="button button-save" type="submit" style="margin-top:12px">Save settings</button><p class="meta" style="margin-top:8px">RAM and jar changes need the server stopped.</p></form></div>
  <div class="panel danger" style="margin-top:16px"><h3 style="margin-bottom:8px">Delete server</h3><p class="lede" style="margin:0 0 12px;font-size:14px">Removes the server and all its files permanently.</p><button class="button button-danger" id="del">Delete this server</button></div>`;
  $('#sf').onsubmit = async e => { e.preventDefault(); try { const { server } = await api(`/api/servers/${cur.id}/settings`, { method: 'PUT', body: { name: $('#sn').value, ramMb: $('#sr').value, jar: $('#sj').value, eula: $('#se').checked } }); cur.srv = server; toast('Settings saved', 'ok'); } catch (er) { fail(er); } };
  $('#del').onclick = async () => { if (await confirmBox(`Delete "${s.name}" and every file in it?`)) try { await api('/api/servers/' + cur.id, { method: 'DELETE' }); toast('Server deleted', 'warn'); location.hash = '#/'; } catch (e) { fail(e); } };
}

(async () => {
  try { me = (await api('/api/auth/me')).user; cfg = await api('/api/config'); } catch { return; }
  $('#who').textContent = me.username + (me.role === 'admin' ? ' · admin' : '');
  $('#logout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.replace('/'); };
  route();
})();

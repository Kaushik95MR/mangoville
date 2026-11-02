'use strict';
// Mango Ville — bookings calendar. SQLite (sql.js/WASM) runs on the phone;
// the database file is saved in IndexedDB on the device. Nothing is sent anywhere.

const SOURCES = ['Direct', 'Airbnb', 'Booking.com', 'Referral', 'Other'];
const CATEGORIES = ['Caretaker / Salary', 'Electricity', 'Water', 'Housekeeping', 'Maintenance', 'Supplies', 'Marketing', 'Gas', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 1,
  guest TEXT DEFAULT '', phone TEXT DEFAULT '', source TEXT DEFAULT 'Direct', total INTEGER DEFAULT 0, advance INTEGER DEFAULT 0,
  settled INTEGER DEFAULT 0, notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT DEFAULT 'Other', amount INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO settings VALUES('fixed_cost','12000');`;
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

let db, tab = 'cal';
const now = new Date();
let cur = { y: now.getFullYear(), m: now.getMonth() };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayISO = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d + n); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const monthKey = () => `${cur.y}-${pad(cur.m + 1)}`;
const inr = n => (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = (s, long) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }); };
const q = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const run = (sql, p = []) => { db.run(sql, p); persist(); };
const due = b => (b.settled ? 0 : Math.max(0, b.total - b.advance));
const fixedCost = () => +q('SELECT value FROM settings WHERE key="fixed_cost"')[0].value || 0;

/* ---------- storage: the .sqlite bytes live in IndexedDB ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('mango-ville', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbGet() { const d = await idb(); return new Promise(res => { const r = d.transaction('f').objectStore('f').get('db'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
async function idbPut(bytes) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('f', 'readwrite'); t.objectStore('f').put(bytes, 'db'); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
let saving = Promise.resolve();
function persist() { const bytes = db.export(); saving = saving.then(() => idbPut(bytes)).catch(e => alert('Could not save: ' + e)); }

/* ---------- data ---------- */
function monthStats() {
  const k = monthKey(), dim = new Date(cur.y, cur.m + 1, 0).getDate();
  const bs = q('SELECT * FROM bookings WHERE substr(start,1,7)=? ORDER BY start,id', [k]);
  const exp = q('SELECT * FROM expenses WHERE substr(date,1,7)=?', [k]);
  const nights = new Set();
  q('SELECT start,nights FROM bookings').forEach(b => { for (let i = 0; i < b.nights; i++) { const d = addDays(b.start, i); if (d.startsWith(k)) nights.add(d); } });
  const revenue = bs.reduce((s, b) => s + b.total, 0), pending = bs.reduce((s, b) => s + due(b), 0);
  const expenses = exp.reduce((s, e) => s + e.amount, 0);
  const fixed = bs.length || exp.length ? fixedCost() : 0;
  const bySource = {}; bs.forEach(b => bySource[b.source] = (bySource[b.source] || 0) + b.total);
  return { bs, exp, revenue, pending, collected: revenue - pending, expenses, fixed, net: revenue - expenses - fixed, occupied: nights.size, dim, bySource };
}

/* ---------- screens ---------- */
function render() {
  $('#title').textContent = `${MONTHS[cur.m]} ${cur.y}`;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ cal: renderCal, exp: renderExp, sum: renderSum })[tab]();
}

function renderCal() {
  const dim = new Date(cur.y, cur.m + 1, 0).getDate(), lead = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7, k = monthKey();
  const bs = q('SELECT * FROM bookings WHERE start<=? AND date(start,"+"||nights||" day")>? ORDER BY start,id', [iso(cur.y, cur.m, dim), iso(cur.y, cur.m, 1)]);
  const per = {};
  bs.forEach(b => { for (let i = 0; i < b.nights; i++) { const d = addDays(b.start, i); if (d.startsWith(k)) (per[d] ||= []).push(b); } });
  const s = monthStats(), today = todayISO();
  let h = `<div class="snap"><div><small>Booked</small><strong>${s.occupied}/${s.dim}</strong></div><div><small>Revenue</small><strong>${inr(s.revenue)}</strong></div><div><small>Due</small><strong class="${s.pending ? 'neg' : ''}">${inr(s.pending)}</strong></div></div>`;
  h += '<div class="cal"><div class="grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) h += '<div class="day blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = iso(cur.y, cur.m, d), list = per[date] || [];
    const cls = list.length ? (list.some(due) ? 'due' : 'paid') : '';
    const label = list.length ? esc((list[0].guest || list[0].source).split(' ')[0]) + (list.length > 1 ? ` +${list.length - 1}` : '') : '';
    h += `<button class="day ${cls}${date === today ? ' today' : ''}${date < today ? ' past' : ''}" data-date="${date}">${d}${label ? `<small>${label}</small>` : ''}</button>`;
  }
  h += '</div></div><div class="legend"><span><i style="background:var(--paid)"></i>Paid</span><span><i style="background:var(--due)"></i>Balance due</span><span>Blank = available</span></div>';
  h += `<button class="fab" id="addB" aria-label="New booking">${PLUS}</button>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('.day[data-date]').forEach(b => b.onclick = () => openDay(b.dataset.date));
  $('#addB').onclick = () => bookingForm(null, today.startsWith(k) ? today : iso(cur.y, cur.m, 1));
}

function bookingRow(b, showDate) {
  const d = due(b);
  return `<button class="row" data-id="${b.id}"><span><b>${esc(b.guest || 'Guest')}</b><small>${showDate ? esc(nice(b.start)) + ' · ' : ''}${esc(b.nights)} night${b.nights > 1 ? 's' : ''} · ${esc(b.source)}</small></span>
  <span class="amt">${inr(b.total)}<br><span class="pill ${d ? 'due' : 'paid'}">${d ? 'Due ' + inr(d) : 'Paid'}</span></span></button>`;
}

function renderExp() {
  const s = monthStats();
  $('#view').innerHTML = `<div class="hero"><small>Spent this month</small><strong>${inr(s.expenses)}</strong></div>
  <div class="card">${s.exp.length ? [...s.exp].sort((a, b) => b.date.localeCompare(a.date)).map(e =>
    `<button class="row" data-eid="${e.id}"><span><b>${esc(e.description || e.category)}</b><small>${esc(nice(e.date))} · ${esc(e.category)}</small></span><span class="amt">${inr(e.amount)}</span></button>`).join('') : '<div class="empty">No expenses this month</div>'}</div>
  <button class="fab" id="addExp" aria-label="Add expense">${PLUS}</button>`;
  $('#addExp').onclick = () => expenseForm();
  document.querySelectorAll('[data-eid]').forEach(b => b.onclick = () => expenseForm(+b.dataset.eid));
}

function renderSum() {
  const s = monthStats();
  const dues = q('SELECT * FROM bookings WHERE settled=0 AND total>advance ORDER BY start');
  const stat = (l, v, cls = '') => `<div class="stat"><small>${l}</small><strong class="${cls}">${v}</strong></div>`;
  $('#view').innerHTML = `<div class="hero"><small>Net profit</small><strong>${inr(s.net)}</strong></div>
  <div class="card"><div class="stats">
    ${stat('Revenue', inr(s.revenue))}${stat('Collected', inr(s.collected))}
    ${stat('Balance due', inr(s.pending), s.pending ? 'neg' : '')}${stat('Occupancy', Math.round(100 * s.occupied / s.dim) + '%')}
    ${stat('Expenses', inr(s.expenses))}${stat('Fixed cost', inr(s.fixed))}</div></div>
  ${Object.keys(s.bySource).length ? `<div class="card"><h2>By source</h2>${Object.entries(s.bySource).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span class="amt">${inr(v)}</span></div>`).join('')}</div>` : ''}
  <div class="card"><h2>Pending dues · ${inr(dues.reduce((a, b) => a + due(b), 0))}</h2>${dues.length ? dues.map(b => bookingRow(b, true)).join('') : '<div class="empty">All settled</div>'}</div>
  <div class="card"><h2>Settings &amp; backup</h2>
    <label class="l">Fixed monthly cost (₹)</label><input id="fixed" type="number" inputmode="numeric" value="${fixedCost()}">
    <button class="btn" id="exportDb">Back up data</button>
    <button class="btn alt" id="importDb">Restore from file</button>
    <input id="file" type="file" accept=".sqlite,.db" hidden></div>`;
  document.querySelectorAll('[data-id]').forEach(b => b.onclick = () => bookingForm(+b.dataset.id));
  $('#fixed').onchange = e => { run('UPDATE settings SET value=? WHERE key="fixed_cost"', [String(+e.target.value || 0)]); renderSum(); };
  $('#exportDb').onclick = exportDb;
  $('#importDb').onclick = () => $('#file').click();
  $('#file').onchange = importDb;
}

/* ---------- bottom sheet ---------- */
function sheet(html) { $('#panel').innerHTML = html; $('#sheet').hidden = false; $('#panel').scrollTop = 0; }
function closeSheet() { $('#sheet').hidden = true; render(); }
$('.scrim').onclick = closeSheet;
const seg = (id, opts, v) => `<div class="seg" id="${id}">${opts.map(o => `<button type="button" class="${o === v ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`;
function wireSeg(id) { const el = $('#' + id); el.onclick = e => { const b = e.target.closest('button'); if (!b) return; el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }; }
const segVal = id => $('#' + id + ' .on')?.textContent;

function openDay(date) {
  const list = q('SELECT * FROM bookings WHERE start<=? AND date(start,"+"||nights||" day")>? ORDER BY start,id', [date, date]);
  sheet(`<h3>${esc(nice(date, true))}</h3><div class="list">${list.length ? list.map(b => bookingRow(b)).join('') : '<div class="empty">Available — no booking</div>'}</div>
    <button class="btn" id="add">New booking</button>`);
  $('#add').onclick = () => bookingForm(null, date);
  document.querySelectorAll('#panel [data-id]').forEach(b => b.onclick = () => bookingForm(+b.dataset.id));
}

function bookingForm(id, date) {
  const b = id ? q('SELECT * FROM bookings WHERE id=?', [id])[0] : { start: date || todayISO(), nights: 1, guest: '', phone: '', source: 'Direct', total: '', advance: '', settled: 0, notes: '' };
  sheet(`<h3>${id ? 'Edit booking' : 'New booking'}</h3>
  <label class="l">Guest</label><input id="f_guest" placeholder="Name" value="${esc(b.guest)}" autocomplete="off">
  <label class="l">Phone</label><input id="f_phone" type="tel" placeholder="Mobile number" value="${esc(b.phone)}">
  <div class="two"><div><label class="l">Check-in</label><input id="f_start" type="date" value="${esc(b.start)}"></div><div><label class="l">Nights</label><input id="f_nights" type="number" inputmode="numeric" min="1" value="${esc(b.nights)}"></div></div>
  <label class="l">Source</label>${seg('f_source', SOURCES, b.source)}
  <div class="two"><div><label class="l">Total ₹</label><input id="f_total" type="number" inputmode="numeric" value="${esc(b.total)}"></div><div><label class="l">Advance ₹</label><input id="f_adv" type="number" inputmode="numeric" value="${esc(b.advance)}"></div></div>
  <div class="bal"><span>Balance</span><span id="balv"></span></div>
  <label class="switch" style="margin-top:14px"><input id="f_settled" type="checkbox"${b.settled ? ' checked' : ''}> Fully paid</label>
  <label class="l">Notes</label><textarea id="f_notes" rows="2">${esc(b.notes)}</textarea>
  <button class="btn" id="save">Save</button>
  ${id && b.phone ? `<a class="btn alt" href="tel:${esc(b.phone)}">Call guest</a>` : ''}
  ${id ? '<button class="btn del" id="del">Delete booking</button>' : ''}`);
  wireSeg('f_source');
  const bal = () => { const d = $('#f_settled').checked ? 0 : Math.max(0, (+$('#f_total').value || 0) - (+$('#f_adv').value || 0)); $('#balv').textContent = d ? inr(d) : 'Nothing due'; $('#balv').className = d ? 'neg' : ''; };
  ['f_total', 'f_adv', 'f_settled'].forEach(i => $('#' + i).oninput = bal); bal();
  $('#save').onclick = () => {
    const v = { start: $('#f_start').value, nights: Math.max(1, Math.floor(+$('#f_nights').value) || 1), guest: $('#f_guest').value.trim(), phone: $('#f_phone').value.trim(), source: segVal('f_source') || 'Direct', total: +$('#f_total').value || 0, advance: +$('#f_adv').value || 0, settled: $('#f_settled').checked ? 1 : 0, notes: $('#f_notes').value.trim() };
    if (!v.start) return alert('Pick a check-in date');
    const p = [v.start, v.nights, v.guest, v.phone, v.source, v.total, v.advance, v.settled, v.notes];
    if (id) run('UPDATE bookings SET start=?,nights=?,guest=?,phone=?,source=?,total=?,advance=?,settled=?,notes=? WHERE id=?', [...p, id]);
    else run('INSERT INTO bookings(start,nights,guest,phone,source,total,advance,settled,notes) VALUES(?,?,?,?,?,?,?,?,?)', p);
    const [y, m] = v.start.split('-').map(Number); cur = { y, m: m - 1 };
    closeSheet();
  };
  if (id) $('#del').onclick = () => { if (confirm('Delete this booking?')) { run('DELETE FROM bookings WHERE id=?', [id]); closeSheet(); } };
}

function expenseForm(id) {
  const e = id ? q('SELECT * FROM expenses WHERE id=?', [id])[0] : { date: todayISO(), description: '', category: 'Other', amount: '' };
  sheet(`<h3>${id ? 'Edit expense' : 'New expense'}</h3>
  <div class="two"><div><label class="l">Amount ₹</label><input id="e_amt" type="number" inputmode="numeric" value="${esc(e.amount)}"></div><div><label class="l">Date</label><input id="e_date" type="date" value="${esc(e.date)}"></div></div>
  <label class="l">Description</label><input id="e_desc" placeholder="What was it for?" value="${esc(e.description)}" autocomplete="off">
  <label class="l">Category</label>${seg('e_cat', CATEGORIES, e.category)}
  <button class="btn" id="save">Save</button>${id ? '<button class="btn del" id="del">Delete expense</button>' : ''}`);
  wireSeg('e_cat');
  $('#save').onclick = () => {
    const p = [$('#e_date').value, $('#e_desc').value.trim(), segVal('e_cat') || 'Other', +$('#e_amt').value || 0];
    if (!p[0]) return alert('Pick a date');
    if (id) run('UPDATE expenses SET date=?,description=?,category=?,amount=? WHERE id=?', [...p, id]);
    else run('INSERT INTO expenses(date,description,category,amount) VALUES(?,?,?,?)', p);
    closeSheet();
  };
  if (id) $('#del').onclick = () => { if (confirm('Delete this expense?')) { run('DELETE FROM expenses WHERE id=?', [id]); closeSheet(); } };
}

/* ---------- backup / restore ---------- */
async function exportDb() {
  const file = new File([db.export()], `mango-ville-${todayISO()}.sqlite`, { type: 'application/octet-stream' });
  try { if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: 'Mango Ville backup' }); } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}
async function importDb(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!confirm('This replaces everything in the app with the contents of this file. Continue?')) return;
  try {
    const next = new SQL.Database(bytes); next.exec(SCHEMA); next.exec('SELECT count(*) FROM bookings'); db = next; persist(); render();
    alert('Restored.');
  } catch (e) { alert('That file is not a Mango Ville backup.'); }
}

/* ---------- boot ---------- */
async function boot() {
  window.SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
  const saved = await idbGet();
  db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.exec(SCHEMA);
  persist();
  navigator.storage?.persist?.();
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  const step = n => { cur.m += n; if (cur.m > 11) { cur.m = 0; cur.y++; } if (cur.m < 0) { cur.m = 11; cur.y--; } render(); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  $('#today').onclick = () => { cur = { y: new Date().getFullYear(), m: new Date().getMonth() }; render(); };
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();

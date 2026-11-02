'use strict';
// Mango Ville — bookings calendar. SQLite (sql.js/WASM) runs in the phone's browser;
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
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const q = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const run = (sql, p = []) => { db.run(sql, p); persist(); };
const due = b => (b.settled ? 0 : Math.max(0, b.total - b.advance));

/* ---------- storage: the .sqlite bytes live in IndexedDB ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('mango-ville', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbGet() { const d = await idb(); return new Promise(res => { const r = d.transaction('f').objectStore('f').get('db'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
async function idbPut(bytes) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('f', 'readwrite'); t.objectStore('f').put(bytes, 'db'); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
let saving = Promise.resolve();
function persist() { const bytes = db.export(); saving = saving.then(() => idbPut(bytes)).catch(e => alert('Could not save: ' + e)); }

/* ---------- data ---------- */
const bookingsCovering = date => q('SELECT * FROM bookings WHERE start<=? AND date(start,"+"||nights||" day")>? ORDER BY start,id', [date, date]);
function monthBookings() { const k = monthKey(); return q('SELECT * FROM bookings WHERE substr(start,1,7)=? ORDER BY start,id', [k]); }
function monthStats() {
  const bs = monthBookings(), k = monthKey(), dim = new Date(cur.y, cur.m + 1, 0).getDate();
  const exp = q('SELECT * FROM expenses WHERE substr(date,1,7)=?', [k]);
  const nights = new Set();
  q('SELECT start,nights FROM bookings').forEach(b => { for (let i = 0; i < b.nights; i++) { const d = addDays(b.start, i); if (d.startsWith(k)) nights.add(d); } });
  const revenue = bs.reduce((s, b) => s + b.total, 0), pending = bs.reduce((s, b) => s + due(b), 0);
  const expenses = exp.reduce((s, e) => s + e.amount, 0);
  const fixed = bs.length || exp.length ? +q('SELECT value FROM settings WHERE key="fixed_cost"')[0].value : 0;
  const bySource = {}; bs.forEach(b => bySource[b.source] = (bySource[b.source] || 0) + b.total);
  return { bs, exp, revenue, pending, collected: revenue - pending, expenses, fixed, net: revenue - expenses - fixed, occupied: nights.size, dim, bySource };
}

/* ---------- render ---------- */
function render() {
  $('#title').textContent = `${MONTHS[cur.m]} ${cur.y}`;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ cal: renderCal, exp: renderExp, sum: renderSum })[tab]();
}

function renderCal() {
  const first = new Date(cur.y, cur.m, 1), dim = new Date(cur.y, cur.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7, k = monthKey();
  const first_ = iso(cur.y, cur.m, 1), last_ = iso(cur.y, cur.m, dim);
  const bs = q('SELECT * FROM bookings WHERE start<=? AND date(start,"+"||nights||" day")>? ORDER BY start,id', [last_, first_]);
  const per = {};
  bs.forEach(b => { for (let i = 0; i < b.nights; i++) { const d = addDays(b.start, i); if (d.startsWith(k)) (per[d] ||= []).push(b); } });
  let h = '<div class="grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) h += '<div class="day blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = iso(cur.y, cur.m, d), list = per[date] || [];
    const chips = list.slice(0, 2).map(b => `<span class="chip ${due(b) ? 'due' : 'paid'}">${esc((b.guest || b.source).split(' ')[0])}</span>`).join('');
    const more = list.length > 2 ? `<span class="chip">+${list.length - 2}</span>` : '';
    h += `<button class="day${date === todayISO() ? ' today' : ''}" data-date="${date}"><b>${d}</b>${chips}${more}</button>`;
  }
  h += '</div><div class="legend"><span><i style="background:var(--paid)"></i>Fully paid</span><span><i style="background:var(--due)"></i>Balance due</span><span>Empty = available</span></div>';
  $('#view').innerHTML = h;
  document.querySelectorAll('.day[data-date]').forEach(b => b.onclick = () => openDay(b.dataset.date));
}

function bookingRow(b, showDate) {
  return `<button class="row" data-id="${b.id}"><span>${esc(b.guest || '(no name)')}<small>${showDate ? nice(b.start) + ' · ' : ''}${b.nights} night${b.nights > 1 ? 's' : ''} · ${esc(b.source)}</small></span>
  <span class="amt">${inr(b.total)}${due(b) ? `<small class="neg">due ${inr(due(b))}</small>` : '<small>paid</small>'}</span></button>`;
}

function renderExp() {
  const s = monthStats();
  $('#view').innerHTML = `<div class="card"><h2>Total spent</h2><div class="stat"><strong>${inr(s.expenses)}</strong></div></div>
  <div class="card">${s.exp.length ? s.exp.sort((a, b) => b.date.localeCompare(a.date)).map(e =>
    `<button class="row" data-eid="${e.id}"><span>${esc(e.description || e.category)}<small>${nice(e.date)} · ${esc(e.category)}</small></span><span class="amt">${inr(e.amount)}</span></button>`).join('') : '<div class="empty">No expenses this month</div>'}</div>
  <button class="fab" id="addExp" aria-label="Add expense">+</button>`;
  $('#addExp').onclick = () => expenseForm();
  document.querySelectorAll('[data-eid]').forEach(b => b.onclick = () => expenseForm(+b.dataset.eid));
}

function renderSum() {
  const s = monthStats();
  const dues = q('SELECT * FROM bookings WHERE settled=0 AND total>advance ORDER BY start');
  const stat = (l, v, cls = '') => `<div class="stat"><small>${l}</small><strong class="${cls}">${v}</strong></div>`;
  $('#view').innerHTML = `<div class="card"><div class="stats">
    ${stat('Revenue', inr(s.revenue))}${stat('Collected', inr(s.collected))}
    ${stat('Balance due', inr(s.pending), s.pending ? 'neg' : '')}${stat('Occupancy', `${s.occupied}/${s.dim} days (${Math.round(100 * s.occupied / s.dim)}%)`)}
    ${stat('Expenses', inr(s.expenses))}${stat('Fixed cost', inr(s.fixed))}
    ${stat('Net profit', inr(s.net), s.net < 0 ? 'neg' : '')}${stat('Avg / night', inr(s.occupied ? s.revenue / s.occupied : 0))}</div></div>
  <div class="card"><h2>Revenue by source</h2>${Object.keys(s.bySource).length ? Object.entries(s.bySource).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span class="amt">${inr(v)}</span></div>`).join('') : '<div class="empty">No bookings this month</div>'}</div>
  <div class="card"><h2>Pending dues (all months) · ${inr(dues.reduce((a, b) => a + due(b), 0))}</h2>${dues.length ? dues.map(b => bookingRow(b, true)).join('') : '<div class="empty">All settled 🎉</div>'}</div>
  <div class="card"><h2>Settings &amp; backup</h2>
    <label>Fixed monthly cost (₹) — charged in months that have bookings or expenses</label><input id="fixed" type="number" inputmode="numeric" value="${s.fixed || q('SELECT value FROM settings WHERE key="fixed_cost"')[0].value}">
    <button class="btn" id="exportDb">Back up data (.sqlite)</button>
    <button class="btn alt" id="importDb">Restore / import from a file</button>
    <input id="file" type="file" accept=".sqlite,.db,.json" hidden></div>`;
  document.querySelectorAll('[data-id]').forEach(b => b.onclick = () => bookingForm(+b.dataset.id));
  $('#fixed').onchange = e => { run('UPDATE settings SET value=? WHERE key="fixed_cost"', [String(+e.target.value || 0)]); renderSum(); };
  $('#exportDb').onclick = exportDb;
  $('#importDb').onclick = () => $('#file').click();
  $('#file').onchange = importDb;
}

/* ---------- bottom sheet ---------- */
function sheet(html) { $('#panel').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; render(); }
$('.scrim').onclick = closeSheet;

function openDay(date) {
  const list = bookingsCovering(date);
  sheet(`<h3>${nice(date)}</h3>${list.length ? list.map(b => bookingRow(b)).join('') : '<div class="empty">Available — no booking</div>'}
    <button class="btn" id="add">+ New booking</button><button class="btn alt" id="close">Close</button>`);
  $('#add').onclick = () => bookingForm(null, date);
  $('#close').onclick = closeSheet;
  document.querySelectorAll('#panel [data-id]').forEach(b => b.onclick = () => bookingForm(+b.dataset.id));
}

function bookingForm(id, date) {
  const b = id ? q('SELECT * FROM bookings WHERE id=?', [id])[0] : { start: date || todayISO(), nights: 1, guest: '', phone: '', source: 'Direct', total: '', advance: '', settled: 0, notes: '' };
  const opt = (arr, v) => arr.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  sheet(`<h3>${id ? 'Edit booking' : 'New booking'}</h3>
  <div class="two"><div><label>Check-in</label><input id="f_start" type="date" value="${b.start}"></div><div><label>Nights</label><input id="f_nights" type="number" inputmode="numeric" min="1" value="${b.nights}"></div></div>
  <label>Guest name</label><input id="f_guest" value="${esc(b.guest)}" autocomplete="off">
  <label>Phone</label><input id="f_phone" type="tel" value="${esc(b.phone)}">
  <label>Source</label><select id="f_source">${opt(SOURCES, b.source)}</select>
  <div class="two"><div><label>Total (₹)</label><input id="f_total" type="number" inputmode="numeric" value="${b.total}"></div><div><label>Advance (₹)</label><input id="f_adv" type="number" inputmode="numeric" value="${b.advance}"></div></div>
  <label class="check"><input id="f_settled" type="checkbox"${b.settled ? ' checked' : ''}> Balance fully paid</label>
  <label>Notes</label><textarea id="f_notes" rows="2">${esc(b.notes)}</textarea>
  <button class="btn" id="save">Save</button>${id && b.phone ? `<a class="btn alt" style="text-align:center;text-decoration:none" href="tel:${esc(b.phone)}">Call guest</a>` : ''}
  ${id ? '<button class="btn del" id="del">Delete booking</button>' : ''}<button class="btn alt" id="cancel">Cancel</button>`);
  $('#cancel').onclick = closeSheet;
  $('#save').onclick = () => {
    const v = { start: $('#f_start').value, nights: Math.max(1, +$('#f_nights').value || 1), guest: $('#f_guest').value.trim(), phone: $('#f_phone').value.trim(), source: $('#f_source').value, total: +$('#f_total').value || 0, advance: +$('#f_adv').value || 0, settled: $('#f_settled').checked ? 1 : 0, notes: $('#f_notes').value.trim() };
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
  <label>Date</label><input id="e_date" type="date" value="${e.date}">
  <label>Description</label><input id="e_desc" value="${esc(e.description)}" autocomplete="off">
  <label>Category</label><select id="e_cat">${CATEGORIES.map(c => `<option${c === e.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <label>Amount (₹)</label><input id="e_amt" type="number" inputmode="numeric" value="${e.amount}">
  <button class="btn" id="save">Save</button>${id ? '<button class="btn del" id="del">Delete</button>' : ''}<button class="btn alt" id="cancel">Cancel</button>`);
  $('#cancel').onclick = closeSheet;
  $('#save').onclick = () => {
    const p = [$('#e_date').value, $('#e_desc').value.trim(), $('#e_cat').value, +$('#e_amt').value || 0];
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
  if (!confirm('This replaces everything currently in the app with the contents of this file. Continue?')) return;
  try {
    const next = new SQL.Database(bytes); next.exec(SCHEMA); db = next; persist(); render();
    alert('Imported.');
  } catch (e) { alert('That file is not a Mango Ville backup.'); }
}

/* ---------- boot ---------- */
async function boot() {
  const SQLmod = await initSqlJs({ locateFile: f => 'vendor/' + f });
  window.SQL = SQLmod;
  const saved = await idbGet();
  db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.exec(SCHEMA);
  persist();
  navigator.storage?.persist?.();
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  const step = n => { cur.m += n; if (cur.m > 11) { cur.m = 0; cur.y++; } if (cur.m < 0) { cur.m = 11; cur.y--; } render(); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();

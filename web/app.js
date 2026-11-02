'use strict';
// Mango Ville — bookings calendar. SQLite (sql.js/WASM) runs on the phone;
// the database file is saved in IndexedDB on the device. Nothing is sent anywhere.

const SOURCES = ['Direct', 'Airbnb', 'Booking.com', 'Referral', 'Other'];
const CATEGORIES = ['Caretaker / Salary', 'Electricity', 'Water', 'Housekeeping', 'Maintenance', 'Supplies', 'Marketing', 'Gas', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 1,
  guest TEXT DEFAULT '', phone TEXT DEFAULT '', source TEXT DEFAULT 'Direct', total INTEGER DEFAULT 0, advance INTEGER DEFAULT 0,
  settled INTEGER DEFAULT 0, notes TEXT DEFAULT '', checkin_time TEXT DEFAULT '14:00', checkout_time TEXT DEFAULT '11:00', guests INTEGER DEFAULT 2);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT DEFAULT 'Other', amount INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', phone TEXT DEFAULT '', city TEXT DEFAULT '',
  id_proof TEXT DEFAULT '', notes TEXT DEFAULT '', id_img BLOB);
INSERT OR IGNORE INTO settings VALUES('fixed_cost','12000');`;
const hasCol = (d, t, c) => (d.exec(`PRAGMA table_info(${t})`)[0]?.values || []).some(r => r[1] === c);
function migrate(d) {
  [['bookings', 'checkin_time', "TEXT DEFAULT '14:00'"], ['bookings', 'checkout_time', "TEXT DEFAULT '11:00'"],
   ['bookings', 'guests', 'INTEGER DEFAULT 2'], ['customers', 'id_img', 'BLOB']]
    .forEach(([t, c, def]) => { if (!hasCol(d, t, c)) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); });
}
/* expense categories: the built-in ones, any you added, and any already used by an expense */
function allCats(selected) {
  let extra = [];
  try { extra = JSON.parse(q("SELECT value FROM settings WHERE key='extra_categories'")[0]?.value || '[]'); } catch (e) { }
  const used = q('SELECT DISTINCT category c FROM expenses').map(r => r.c);
  const list = [...new Set([...CATEGORIES, ...extra, ...used, selected].filter(Boolean))].filter(c => c !== 'Other');
  return [...list, 'Other'];
}
const catChips = sel => allCats(sel).map(o => `<button type="button" class="${o === sel ? 'on' : ''}">${esc(o)}</button>`).join('');
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

let db, tab = 'cal', custQuery = '';
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
const np = p => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; };
const sameCust = (c, name, phone) => {
  const a = np(c.phone), b = np(phone);
  if (a && b) return a === b;
  const n1 = String(c.name || '').trim().toLowerCase();
  return !!n1 && n1 === String(name || '').trim().toLowerCase();
};
function ensureCustomer(name, phone) {
  name = String(name || '').trim();
  if ((!name && !np(phone)) || (!np(phone) && SOURCES.includes(name))) return 0;
  const hit = q('SELECT * FROM customers').find(c => sameCust(c, name, phone));
  if (hit) {
    if (!np(hit.phone) && np(phone)) db.run('UPDATE customers SET phone=? WHERE id=?', [np(phone), hit.id]);
    return hit.id;
  }
  db.run('INSERT INTO customers(name,phone) VALUES(?,?)', [name, np(phone)]);
  return q('SELECT max(id) m FROM customers')[0].m;
}
function backfillCustomers() { q('SELECT guest,phone FROM bookings').forEach(b => ensureCustomer(b.guest, b.phone)); persist(); }
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
  $('.monthbar').style.display = tab === 'cus' ? 'none' : '';
  ({ cal: renderCal, exp: renderExp, sum: renderSum, cus: renderCus })[tab]();
}

function renderCal() {
  const dim = new Date(cur.y, cur.m + 1, 0).getDate(), lead = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7, k = monthKey();
  const bs = q('SELECT * FROM bookings WHERE start<=? AND date(start,"+"||nights||" day")>? ORDER BY start,id', [iso(cur.y, cur.m, dim), iso(cur.y, cur.m, 1)]);
  const per = {};
  bs.forEach(b => { for (let i = 0; i < b.nights; i++) { const d = addDays(b.start, i); if (d.startsWith(k)) (per[d] ||= []).push(b); } });
  const s = monthStats(), today = todayISO();
  let h = `<div class="snap"><div><small>Revenue</small><strong>${inr(s.revenue)}</strong></div><div><small>Profit</small><strong class="${s.net < 0 ? 'neg' : ''}">${inr(s.net)}</strong></div><div><small>Booked</small><strong>${s.occupied}/${s.dim}</strong></div><div><small>Due</small><strong class="${s.pending ? 'neg' : ''}">${inr(s.pending)}</strong></div></div>`;
  h += '<div class="cal"><div class="grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) h += '<div class="day blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const date = iso(cur.y, cur.m, d), list = per[date] || [];
    const cls = list.length ? 'booked' + (list.some(due) ? ' hasdue' : '') : date < today ? 'miss' : 'free';
    const b = list[0];
    let info = '';
    if (b) {
      info = `<small>${esc((b.guest || b.source).split(' ')[0])}${list.length > 1 ? ` +${list.length - 1}` : ''}</small>`;
      if (b.start === date) info += `${b.phone ? `<small>${esc(b.phone)}</small>` : ''}<small>T ${esc(b.total)}</small><small>A ${esc(b.advance)}</small><small class="${due(b) ? 'dueamt' : ''}">${due(b) ? 'D ' + esc(due(b)) : 'Paid'}</small>`;
      else info += '<small>↳ stay</small>';
    }
    h += `<button class="day ${cls}${date === today ? ' today' : ''}" data-date="${date}">${d}${info}</button>`;
  }
  h += '</div></div><div class="legend"><span><i style="background:var(--booked)"></i>Booked</span><span><i style="background:var(--miss)"></i>Not occupied</span><span><i style="background:var(--free)"></i>Available</span><span>T total · A advance · D due</span></div>';
  h += `<button class="fab" id="addB" aria-label="New booking">${PLUS}</button>`;
  $('#view').innerHTML = h;
  document.querySelectorAll('.day[data-date]').forEach(b => b.onclick = () => openDay(b.dataset.date));
  $('#addB').onclick = () => bookingForm(null, today.startsWith(k) ? today : iso(cur.y, cur.m, 1));
}

function bookingRow(b, showDate) {
  const d = due(b);
  return `<button class="row" data-id="${b.id}"><span><b>${esc(b.guest || 'Guest')}</b><small>${showDate ? esc(nice(b.start)) + ' · ' : ''}${esc(b.nights)} night${b.nights > 1 ? 's' : ''}${b.guests ? ' · ' + esc(b.guests) + ' guests' : ''} · ${esc(b.source)}</small></span>
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

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
  return new Uint8Array(await blob.arrayBuffer());
}
/* Aadhaar photo box. st = { stored: bytes|null (already on file), pending: bytes|null (new, saved with the form) } */
function paintId(host, st) {
  const img = st.pending || st.stored;
  const url = img ? URL.createObjectURL(new Blob([img], { type: 'image/jpeg' })) : '';
  host.innerHTML = img
    ? `<div class="idcard ok"><img src="${url}" alt="Aadhaar"><div><b>${st.pending ? 'Aadhaar attached' : '✓ Verified'}</b><small>${st.pending ? 'Saved when you tap Save' : 'Aadhaar already on file — no need to upload again'}</small><label class="mini">Replace<input type="file" accept="image/*" hidden></label></div></div>`
    : `<label class="idcard up"><b>Upload Aadhaar</b><small>Photo of the card. Stored only on this phone.</small><input type="file" accept="image/*" hidden></label>`;
  host.querySelector('input').onchange = async e => { const f = e.target.files[0]; if (f) { st.pending = await compressImage(f); paintId(host, st); } };
}

function custRows() {
  const bookings = q('SELECT * FROM bookings'), s = custQuery.trim().toLowerCase();
  return q('SELECT * FROM customers').map(c => {
    const bs = bookings.filter(b => sameCust(c, b.guest, b.phone));
    return { c, bs, spent: bs.reduce((a, b) => a + b.total, 0), owed: bs.reduce((a, b) => a + due(b), 0), last: bs.reduce((m, b) => (b.start > m ? b.start : m), '') };
  }).filter(r => !s || [r.c.name, r.c.phone, r.c.city].some(x => String(x || '').toLowerCase().includes(s)))
    .sort((a, b) => b.last.localeCompare(a.last) || String(a.c.name).localeCompare(String(b.c.name)));
}
function drawCus() {
  const rows = custRows();
  $('#clist').innerHTML = rows.length ? rows.map(r => `<button class="row" data-cid="${r.c.id}"><span><b>${esc(r.c.name || r.c.phone || 'Unnamed')}</b>
    <small>${r.c.id_img ? '✓ ID · ' : ''}${esc(r.c.phone)}${r.c.city ? ' · ' + esc(r.c.city) : ''} · ${r.bs.length} stay${r.bs.length === 1 ? '' : 's'}${r.last ? ' · last ' + esc(nice(r.last)) : ''}</small></span>
    <span class="amt">${inr(r.spent)}${r.owed ? `<br><span class="pill due">Due ${inr(r.owed)}</span>` : ''}</span></button>`).join('') : '<div class="empty">No customers found</div>';
  document.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => customerForm(+b.dataset.cid));
}
function renderCus() {
  $('#view').innerHTML = `<h2 style="margin:6px 4px 10px;font-size:26px;letter-spacing:-.02em">Customers</h2>
  <input id="cq" type="search" placeholder="Search name, phone or city" value="${esc(custQuery)}">
  <div class="card" id="clist" style="padding:4px 16px"></div><button class="fab" id="addC" aria-label="Add customer">${PLUS}</button>`;
  $('#cq').oninput = e => { custQuery = e.target.value; drawCus(); };
  $('#addC').onclick = () => customerForm();
  drawCus();
}

function customerForm(id) {
  const c = id ? q('SELECT * FROM customers WHERE id=?', [id])[0] : { name: '', phone: '', city: '', id_proof: '', notes: '', id_img: null };
  const bs = id ? q('SELECT * FROM bookings ORDER BY start DESC').filter(b => sameCust(c, b.guest, b.phone)) : [];
  const st = { stored: c.id_img || null, pending: null };
  sheet(`<h3>${id ? 'Customer' : 'New customer'}</h3>
  <label class="l">Name</label><input id="c_name" value="${esc(c.name)}" autocomplete="off">
  <label class="l">Phone</label><input id="c_phone" type="tel" value="${esc(c.phone)}">
  <label class="l">City / address</label><input id="c_city" value="${esc(c.city)}">
  <label class="l">Aadhaar number (optional)</label><input id="c_id" inputmode="numeric" placeholder="12-digit number" value="${esc(c.id_proof)}">
  <label class="l">Aadhaar photo</label><div id="idbox"></div>
  <label class="l">Notes</label><textarea id="c_notes" rows="2" placeholder="Preferences, group size, vehicle...">${esc(c.notes)}</textarea>
  ${bs.length ? `<label class="l">Stays · ${bs.length} · ${inr(bs.reduce((a, b) => a + b.total, 0))}</label><div class="list">${bs.map(b => bookingRow(b, true)).join('')}</div>` : ''}
  <button class="btn" id="save">Save</button>
  ${id && c.phone ? `<a class="btn alt" href="tel:${esc(c.phone)}">Call</a>` : ''}
  ${id ? '<button class="btn del" id="del">Delete contact (bookings stay)</button>' : ''}`);
  paintId($('#idbox'), st);
  document.querySelectorAll('#panel [data-id]').forEach(b => b.onclick = () => bookingForm(+b.dataset.id));
  $('#save').onclick = () => {
    const v = { name: $('#c_name').value.trim(), phone: np($('#c_phone').value), city: $('#c_city').value.trim(), id_proof: $('#c_id').value.trim(), notes: $('#c_notes').value.trim() };
    if (!v.name && !v.phone) return alert('Enter a name or phone number');
    const img = st.pending || st.stored;
    if (id) {
      bs.forEach(b => db.run('UPDATE bookings SET guest=?,phone=? WHERE id=?', [v.name, v.phone, b.id]));
      run('UPDATE customers SET name=?,phone=?,city=?,id_proof=?,notes=?,id_img=? WHERE id=?', [v.name, v.phone, v.city, v.id_proof, v.notes, img, id]);
    } else run('INSERT INTO customers(name,phone,city,id_proof,notes,id_img) VALUES(?,?,?,?,?,?)', [v.name, v.phone, v.city, v.id_proof, v.notes, img]);
    closeSheet();
  };
  if (id) $('#del').onclick = () => { if (confirm('Delete this contact? Their bookings are kept.')) { run('DELETE FROM customers WHERE id=?', [id]); closeSheet(); } };
}

/* ---------- bottom sheet ---------- */
function sheet(html) {
  $('#panel').innerHTML = `<button class="x" id="xclose" aria-label="Close">×</button>` + html;
  $('#xclose').onclick = closeSheet;
  $('#sheet').hidden = false; $('#panel').scrollTop = 0;
}
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

const VILLA = 'Mango Ville';
const clock12 = t => { const [h, m] = String(t || '12:00').split(':').map(Number); return `${h % 12 || 12}:${pad(m || 0)} ${h < 12 ? 'AM' : 'PM'}`; };
const stamp = (d, t) => { const [y, m, dd] = d.split('-').map(Number); return `${new Date(y, m - 1, dd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${clock12(t)}`; };
function bookingText(b) {
  const bal = due(b);
  return [`*Booking confirmation — ${VILLA}*`, '',
    `Guest: ${b.guest || 'Guest'}`,
    `Check-in: ${stamp(b.start, b.checkin_time)}`,
    `Check-out: ${stamp(addDays(b.start, b.nights), b.checkout_time)}`,
    `Stay: ${b.nights} night${b.nights > 1 ? 's' : ''} · ${b.guests || 1} guest${b.guests > 1 ? 's' : ''}`, '',
    `Total: ${inr(b.total)}`, `Advance paid: ${inr(b.advance)}`,
    bal ? `Balance due: ${inr(bal)}` : 'Payment: fully paid ✓', '',
    `Thank you for choosing ${VILLA}. We look forward to hosting you!`].join('\n');
}
function shareBooking(id) {
  const b = q('SELECT * FROM bookings WHERE id=?', [id])[0]; if (!b) return;
  const text = bookingText(b), bal = due(b);
  sheet(`<h3>Booking details</h3>
  <div class="card" style="margin-top:10px"><h2>${esc(VILLA)} · confirmation</h2>
    <div class="row"><span>Guest</span><span class="amt">${esc(b.guest || 'Guest')}</span></div>
    <div class="row"><span>Check-in</span><span class="amt">${esc(stamp(b.start, b.checkin_time))}</span></div>
    <div class="row"><span>Check-out</span><span class="amt">${esc(stamp(addDays(b.start, b.nights), b.checkout_time))}</span></div>
    <div class="row"><span>Stay</span><span class="amt">${esc(b.nights)} night${b.nights > 1 ? 's' : ''} · ${esc(b.guests || 1)} guests</span></div>
    <div class="row"><span>Total</span><span class="amt">${inr(b.total)}</span></div>
    <div class="row"><span>Advance</span><span class="amt">${inr(b.advance)}</span></div>
    <div class="row"><span>${bal ? 'Balance due' : 'Payment'}</span><span class="amt ${bal ? 'neg' : ''}">${bal ? inr(bal) : 'Fully paid'}</span></div></div>
  <button class="btn" id="sh_share">Share</button>
  <a class="btn alt" id="sh_wa" target="_blank" rel="noopener" href="https://wa.me/${np(b.phone) ? '91' + np(b.phone) : ''}?text=${encodeURIComponent(text)}">Send on WhatsApp</a>
  <button class="btn alt" id="sh_copy">Copy text</button>`);
  $('#sh_share').onclick = async () => {
    try { if (navigator.share) return await navigator.share({ title: VILLA + ' booking', text }); } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); alert('Sharing is not available here — details copied.'); } catch (e) { alert(text); }
  };
  $('#sh_copy').onclick = async () => { try { await navigator.clipboard.writeText(text); $('#sh_copy').textContent = 'Copied ✓'; } catch (e) { alert(text); } };
}

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function bookingForm(id, date) {
  const b = id ? q('SELECT * FROM bookings WHERE id=?', [id])[0] : { start: date || todayISO(), nights: 1, guest: '', phone: '', source: 'Direct', total: '', advance: '', settled: 0, notes: '', checkin_time: '14:00', checkout_time: '11:00', guests: 2 };
  const st = { stored: null, pending: null };
  const custs = q('SELECT id,name,phone,id_img FROM customers');
  sheet(`<h3>${id ? 'Edit booking' : 'New booking'}</h3>
  <label class="l">Guest name</label><input id="f_guest" placeholder="Name" value="${esc(b.guest)}" autocomplete="off">
  <div id="sug" class="seg" style="margin-top:8px"></div>
  <label class="l">Phone</label><input id="f_phone" type="tel" placeholder="Mobile number" value="${esc(b.phone)}">
  <div id="idbox" style="margin-top:10px"></div>
  <div class="two"><div><label class="l">Check-in</label><input id="f_start" type="date" value="${esc(b.start)}"></div><div><label class="l">Time</label><input id="f_in" type="time" value="${esc(b.checkin_time || '14:00')}"></div></div>
  <div class="two"><div><label class="l">Check-out</label><input id="f_end" type="date" value="${esc(addDays(b.start, b.nights))}"></div><div><label class="l">Time</label><input id="f_out" type="time" value="${esc(b.checkout_time || '11:00')}"></div></div>
  <div class="two"><div><label class="l">Guests</label><input id="f_guests" type="number" inputmode="numeric" min="1" value="${esc(b.guests || 2)}"></div><div><label class="l">Stay</label><div class="bal" style="margin:0;padding:12px"><span id="nn"></span></div></div></div>
  <label class="l">Source</label>${seg('f_source', SOURCES, b.source)}
  <div class="two"><div><label class="l">Total ₹</label><input id="f_total" type="number" inputmode="numeric" value="${esc(b.total)}"></div><div><label class="l">Advance ₹</label><input id="f_adv" type="number" inputmode="numeric" value="${esc(b.advance)}"></div></div>
  <div class="bal"><span>Balance</span><span id="balv"></span></div>
  <label class="switch" style="margin-top:14px"><input id="f_settled" type="checkbox"${b.settled ? ' checked' : ''}> Fully paid</label>
  <label class="l">Notes</label><textarea id="f_notes" rows="2">${esc(b.notes)}</textarea>
  <button class="btn" id="save">Save</button>
  ${id ? '<button class="btn alt" id="shareb">Share booking details</button>' : ''}
  ${id && b.phone ? `<a class="btn alt" href="tel:${esc(b.phone)}">Call guest</a>` : ''}
  ${id ? '<button class="btn del" id="del">Delete booking</button>' : ''}`);
  wireSeg('f_source');

  // returning guests: fill in details and reuse the Aadhaar already on file
  const lookup = () => {
    const name = $('#f_guest').value.trim(), ph = $('#f_phone').value;
    const all = q('SELECT * FROM customers');
    let hits = np(ph).length >= 10 ? all.filter(c => np(c.phone) === np(ph)) : name ? all.filter(c => c.name.trim().toLowerCase() === name.toLowerCase()) : [];
    const c = hits.length === 1 ? hits[0] : null;
    if (c) { if (!name) $('#f_guest').value = c.name; if (!np(ph)) $('#f_phone').value = c.phone; }
    st.stored = c ? c.id_img || null : null;
    paintId($('#idbox'), st);
  };
  // previous guests matching what is typed — tap one to fill the name and phone
  const suggest = () => {
    const t = $('#f_guest').value.trim().toLowerCase(), d = np($('#f_phone').value);
    const exact = custs.filter(c => (np($('#f_phone').value).length >= 10 ? np(c.phone) === d : c.name.trim().toLowerCase() === t && t));
    const list = exact.length === 1 || (t.length < 2 && d.length < 3) ? [] :
      custs.filter(c => (t.length >= 2 && c.name.toLowerCase().includes(t)) || (d.length >= 3 && np(c.phone).includes(d))).slice(0, 4);
    $('#sug').innerHTML = list.map(c => `<button type="button" data-sid="${c.id}">${esc(c.name || c.phone)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.id_img ? ' ✓' : ''}</button>`).join('');
    $('#sug').querySelectorAll('button').forEach(x => x.onclick = () => { const c = custs.find(k => k.id === +x.dataset.sid); $('#f_guest').value = c.name; $('#f_phone').value = c.phone; lookup(); suggest(); });
  };
  $('#f_guest').oninput = suggest;
  $('#f_guest').onchange = () => { lookup(); suggest(); };
  $('#f_phone').oninput = () => { if (np($('#f_phone').value).length >= 10) lookup(); suggest(); };
  $('#f_phone').onchange = lookup;
  lookup();

  const nights = () => Math.max(1, dayDiff($('#f_start').value, $('#f_end').value) || 1);
  const stay = () => { const n = nights(); $('#nn').textContent = `${n} night${n > 1 ? 's' : ''}`; };
  $('#f_start').onchange = () => { if (dayDiff($('#f_start').value, $('#f_end').value) < 1) $('#f_end').value = addDays($('#f_start').value, 1); stay(); };
  $('#f_end').onchange = stay; stay();
  const bal = () => { const d = $('#f_settled').checked ? 0 : Math.max(0, (+$('#f_total').value || 0) - (+$('#f_adv').value || 0)); $('#balv').textContent = d ? inr(d) : 'Nothing due'; $('#balv').className = d ? 'neg' : ''; };
  ['f_total', 'f_adv', 'f_settled'].forEach(i => $('#' + i).oninput = bal); bal();

  $('#save').onclick = () => {
    const v = { start: $('#f_start').value, nights: nights(), guest: $('#f_guest').value.trim(), phone: np($('#f_phone').value), source: segVal('f_source') || 'Direct', total: +$('#f_total').value || 0, advance: +$('#f_adv').value || 0, settled: $('#f_settled').checked ? 1 : 0, notes: $('#f_notes').value.trim(), cin: $('#f_in').value || '14:00', cout: $('#f_out').value || '11:00', guests: Math.max(1, Math.floor(+$('#f_guests').value) || 1) };
    if (!v.start) return alert('Pick a check-in date');
    const p = [v.start, v.nights, v.guest, v.phone, v.source, v.total, v.advance, v.settled, v.notes, v.cin, v.cout, v.guests];
    const cid = ensureCustomer(v.guest, v.phone);
    if (st.pending && cid) db.run('UPDATE customers SET id_img=? WHERE id=?', [st.pending, cid]);
    let bid = id;
    if (id) run('UPDATE bookings SET start=?,nights=?,guest=?,phone=?,source=?,total=?,advance=?,settled=?,notes=?,checkin_time=?,checkout_time=?,guests=? WHERE id=?', [...p, id]);
    else { run('INSERT INTO bookings(start,nights,guest,phone,source,total,advance,settled,notes,checkin_time,checkout_time,guests) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', p); bid = q('SELECT max(id) m FROM bookings')[0].m; }
    const [y, m] = v.start.split('-').map(Number); cur = { y, m: m - 1 };
    closeSheet();
    if (!id) shareBooking(bid);
  };
  if (id) $('#shareb').onclick = () => shareBooking(id);
  if (id) $('#del').onclick = () => { if (confirm('Delete this booking?')) { run('DELETE FROM bookings WHERE id=?', [id]); closeSheet(); } };
}

function expenseForm(id) {
  const e = id ? q('SELECT * FROM expenses WHERE id=?', [id])[0] : { date: todayISO(), description: '', category: 'Other', amount: '' };
  sheet(`<h3>${id ? 'Edit expense' : 'New expense'}</h3>
  <div class="two"><div><label class="l">Amount ₹</label><input id="e_amt" type="number" inputmode="numeric" value="${esc(e.amount)}"></div><div><label class="l">Date</label><input id="e_date" type="date" value="${esc(e.date)}"></div></div>
  <label class="l">Description</label><input id="e_desc" placeholder="What was it for?" value="${esc(e.description)}" autocomplete="off">
  <label class="l">Category</label>${seg('e_cat', allCats(e.category), e.category)}
  <div style="display:flex;gap:8px;margin-top:8px"><input id="e_newcat" placeholder="New category" autocomplete="off"><button type="button" class="btn alt" id="e_addcat" style="width:auto;margin:0;padding:0 18px">Add</button></div>
  <button class="btn" id="save">Save</button>${id ? '<button class="btn del" id="del">Delete expense</button>' : ''}`);
  wireSeg('e_cat');
  $('#e_addcat').onclick = () => {
    const name = $('#e_newcat').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const known = allCats(e.category).find(c => c.toLowerCase() === name.toLowerCase());
    if (!known) {
      let extra = [];
      try { extra = JSON.parse(q("SELECT value FROM settings WHERE key='extra_categories'")[0]?.value || '[]'); } catch (x) { }
      run("INSERT OR REPLACE INTO settings(key,value) VALUES('extra_categories',?)", [JSON.stringify([...extra, name])]);
    }
    $('#e_cat').innerHTML = catChips(known || name);
    $('#e_newcat').value = '';
  };
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
    const next = new SQL.Database(bytes); next.exec(SCHEMA); migrate(next); next.exec('SELECT count(*) FROM bookings'); db = next; backfillCustomers(); render();
    alert('Restored.');
  } catch (e) { alert('That file is not a Mango Ville backup.'); }
}

/* ---------- boot ---------- */
async function boot() {
  window.SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
  let saved = await idbGet();
  if (!saved) {
    // first launch: start from the bundled history
    try { const r = await fetch('seed.sqlite'); if (r.ok) saved = new Uint8Array(await r.arrayBuffer()); } catch (e) { }
  }
  db = saved ? new SQL.Database(saved) : new SQL.Database();
  db.exec(SCHEMA);
  migrate(db);
  backfillCustomers();
  navigator.storage?.persist?.();
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  const step = n => { cur.m += n; if (cur.m > 11) { cur.m = 0; cur.y++; } if (cur.m < 0) { cur.m = 11; cur.y--; } render(); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  $('#today').onclick = () => { cur = { y: new Date().getFullYear(), m: new Date().getMonth() }; render(); };
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();

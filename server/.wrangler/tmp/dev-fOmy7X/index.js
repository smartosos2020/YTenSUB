var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/logic.ts
var PLAN_RANK = { free: 0, pro: 1, pro_plus: 2 };
function effectivePlan(user, now) {
  if (user.plan !== "free" && user.expiresAt && user.expiresAt > now) return user.plan;
  return "free";
}
__name(effectivePlan, "effectivePlan");
function toEntitlement(user, now, graceDays2, globalFilterSensitive2 = true) {
  return {
    plan: effectivePlan(user, now),
    expiresAt: user.expiresAt,
    graceDays: graceDays2,
    filterSensitive: resolveFilterSensitive(user, globalFilterSensitive2)
  };
}
__name(toEntitlement, "toEntitlement");
function resolveFilterSensitive(user, globalOn) {
  return user.filterSensitive ?? globalOn;
}
__name(resolveFilterSensitive, "resolveFilterSensitive");
function applyCard(user, card, now) {
  const base = user.expiresAt && user.expiresAt > now ? user.expiresAt : now;
  const active = effectivePlan(user, now);
  const plan = PLAN_RANK[active] >= PLAN_RANK[card.plan] ? active : card.plan;
  return {
    ...user,
    plan,
    expiresAt: base + card.days * 864e5,
    updatedAt: now
  };
}
__name(applyCard, "applyCard");
function chooseMailProvider(env) {
  if (env.RESEND_API_KEY) return "resend";
  if (env.SENDGRID_API_KEY) return "sendgrid";
  return null;
}
__name(chooseMailProvider, "chooseMailProvider");
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCardCode(rand) {
  const pick = /* @__PURE__ */ __name(() => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)], "pick");
  const group = /* @__PURE__ */ __name(() => pick() + pick() + pick() + pick(), "group");
  return `YTS-${group()}-${group()}-${group()}`;
}
__name(makeCardCode, "makeCardCode");
function normalizeCardCode(input) {
  return input.trim().toUpperCase();
}
__name(normalizeCardCode, "normalizeCardCode");
function isValidCardCode(code) {
  return /^YTS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
}
__name(isValidCardCode, "isValidCardCode");
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
__name(isValidEmail, "isValidEmail");
var CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
function sanitizePrefs(input, now) {
  if (!input || typeof input !== "object") return null;
  const raw = input;
  const level = raw.curatedLevel === null || raw.curatedLevel === void 0 ? null : CEFR_LEVELS.includes(raw.curatedLevel) ? raw.curatedLevel : void 0;
  if (level === void 0) return null;
  if (!Array.isArray(raw.curatedTags)) return null;
  const tags = [
    ...new Set(
      raw.curatedTags.filter((t) => typeof t === "string" && t.trim().length > 0 && t.length <= 24)
    )
  ].slice(0, 16);
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? raw.updatedAt : now;
  return { curatedLevel: level, curatedTags: tags, updatedAt };
}
__name(sanitizePrefs, "sanitizePrefs");
function mergePrefs(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  return local.updatedAt > remote.updatedAt ? local : remote;
}
__name(mergePrefs, "mergePrefs");
function normalizeChannelHandle(input) {
  let s = input.trim();
  if (!s) return null;
  const urlMatch = /(?:youtube\.com\/)?(?:@)([\w.-]+)/i.exec(s);
  if (s.includes("youtube.com") || s.startsWith("@")) {
    if (!urlMatch) return null;
    s = "@" + urlMatch[1];
  }
  if (/^UC[\w-]{22}$/.test(s)) return s;
  if (/^@[\w.-]{2,100}$/.test(s)) return s;
  if (/^[\w.-]{2,100}$/.test(s)) return "@" + s;
  return null;
}
__name(normalizeChannelHandle, "normalizeChannelHandle");
function isValidVideoId(id) {
  return /^[\w-]{11}$/.test(id);
}
__name(isValidVideoId, "isValidVideoId");
function sanitizeAnnounce(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  return s ? s.slice(0, 500) : null;
}
__name(sanitizeAnnounce, "sanitizeAnnounce");
function grantPlan(user, plan, days, now) {
  return applyCard(user, { code: "(admin)", plan, days }, now);
}
__name(grantPlan, "grantPlan");
function revokePlan(user, now) {
  return { ...user, plan: "free", expiresAt: null, updatedAt: now };
}
__name(revokePlan, "revokePlan");

// src/admin-page.ts
var ADMIN_PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YTenSUB \u7BA1\u7406</title>
<style>
  body { font-family: ui-monospace, Consolas, monospace; max-width: 860px; margin: 24px auto; padding: 0 16px; background: #0f0f0f; color: #eee; }
  h1 { font-size: 18px; } h2 { font-size: 14px; margin-top: 32px; border-bottom: 1px solid #333; padding-bottom: 6px; }
  input, select, button { font: inherit; padding: 6px 10px; background: #1c1c1c; color: #eee; border: 1px solid #444; border-radius: 6px; }
  button { cursor: pointer; background: #2d2d2d; } button:hover { background: #3a3a3a; }
  .row { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; align-items: center; }
  pre { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }
  .used { color: #888; } .ok { color: #7dd787; } .err { color: #ff7b72; }
  .tabs { display: flex; gap: 4px; margin-top: 20px; border-bottom: 1px solid #333; }
  .tabs button { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 16px; color: #999; }
  .tabs button:hover { background: #1c1c1c; color: #eee; }
  .tabs button.on { color: #fff; border-bottom-color: #7dd787; }
  .panel { display: none; } .panel.on { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 10px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; word-break: break-all; }
  th { color: #999; font-weight: normal; }
</style>
</head>
<body>
<h1>YTenSUB \u7BA1\u7406</h1>
<div class="row">
  <input id="tok" type="password" placeholder="admin token" size="40">
  <button onclick="saveTok()">\u4FDD\u5B58 token</button>
  <span id="tokMsg"></span>
</div>

<div class="tabs">
  <button data-tab="members" class="on" onclick="switchTab('members')">\u4F1A\u5458\u7BA1\u7406</button>
  <button data-tab="subs" onclick="switchTab('subs')">\u8BA2\u9605\u7BA1\u7406</button>
  <button data-tab="content" onclick="switchTab('content')">\u5185\u5BB9\u7BA1\u7406</button>
  <button data-tab="settings" onclick="switchTab('settings')">\u8BBE\u7F6E</button>
</div>

<section id="tab-members" class="panel on">
  <h2>\u4F1A\u5458\u5217\u8868</h2>
  <div class="row"><button onclick="listUsers()">\u5237\u65B0</button><span id="usersMsg"></span></div>
  <table id="usersTable" style="display:none">
    <thead><tr><th>email</th><th>\u751F\u6548\u6863\u4F4D</th><th>\u5230\u671F\u65F6\u95F4</th><th>\u654F\u611F\u8FC7\u6EE4</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody id="usersBody"></tbody>
  </table>

  <h2>\u6309\u90AE\u7BB1\u67E5\u8BE2</h2>
  <div class="row">
    <input id="qemail" type="email" placeholder="user@example.com" size="30">
    <button onclick="lookupUser()">\u67E5\u8BE2\u5E76\u9009\u4E2D</button>
    <span id="queryMsg"></span>
  </div>

  <h2>\u64CD\u4F5C\u53F0</h2>
  <div class="row" id="benchEmpty">\u672A\u9009\u4E2D\u4F1A\u5458\uFF1A\u5728\u4E0A\u65B9\u5217\u8868\u70B9\u300C\u9009\u4E2D\u300D\uFF0C\u6216\u6309\u90AE\u7BB1\u67E5\u8BE2\u3002</div>
  <div id="bench" style="display:none">
    <div class="row"><span>\u5F53\u524D\u9009\u4E2D\uFF1A</span><b id="benchEmail"></b></div>
    <pre id="benchInfo">\u2014</pre>
    <div class="row">
      <span>\u5F00\u901A/\u987A\u5EF6\uFF1A</span>
      <select id="grantPlan"><option value="pro">pro</option><option value="pro_plus">pro_plus</option></select>
      <input id="grantDays" type="number" value="365" min="1" max="3650" style="width:80px"> \u5929
      <button onclick="grantUserPlan()">\u6267\u884C</button>
      <span id="grantMsg"></span>
    </div>
    <div class="row">
      <button onclick="revokeUserPlan()">\u540A\u9500\u6743\u76CA</button>
      <span id="revokeMsg"></span>
    </div>
    <div class="row">
      <span>\u654F\u611F\u8FC7\u6EE4\u8986\u76D6\uFF1A</span>
      <select id="ufMode"><option value="inherit">\u8DDF\u968F\u5168\u5C40</option><option value="on">\u5F3A\u5236\u5F00</option><option value="off">\u5F3A\u5236\u5173</option></select>
      <button onclick="saveUserFilter()">\u4FDD\u5B58</button>
      <span id="ufMsg"></span>
    </div>
  </div>
</section>

<section id="tab-subs" class="panel">
  <h2>\u751F\u6210\u5361\u5BC6</h2>
  <div class="row">
    <select id="plan"><option value="pro">pro</option><option value="pro_plus">pro_plus</option></select>
    <input id="days" type="number" value="365" min="1" max="3650" style="width:80px"> \u5929
    <input id="count" type="number" value="5" min="1" max="100" style="width:70px"> \u5F20
    <button onclick="genCards()">\u751F\u6210</button>
  </div>
  <pre id="genOut">\u2014</pre>

  <h2>\u5361\u5BC6\u5217\u8868\uFF08\u6700\u8FD1 100 \u6761\uFF09</h2>
  <div class="row"><button onclick="listCards()">\u5237\u65B0</button><span id="cardsMsg"></span></div>
  <table id="cardsTable" style="display:none">
    <thead><tr><th>\u5361\u5BC6</th><th>\u6863\u4F4D</th><th>\u5929\u6570</th><th>\u72B6\u6001</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody id="cardsBody"></tbody>
  </table>

  <h2>\u8FD1\u671F\u5230\u671F\uFF0830 \u5929\u5185\u7684\u4ED8\u8D39\u4F1A\u5458\uFF09</h2>
  <div class="row"><button onclick="listExpiring()">\u5237\u65B0</button><span id="expMsg"></span></div>
  <table id="expTable" style="display:none">
    <thead><tr><th>email</th><th>\u6863\u4F4D</th><th>\u5230\u671F\u65F6\u95F4</th><th>\u5269\u4F59</th></tr></thead>
    <tbody id="expBody"></tbody>
  </table>
</section>

<section id="tab-content" class="panel">
  <h2>\u7528\u6237\u9891\u9053\u5BA1\u6838\uFF08C1\uFF09</h2>
  <div class="row">
    <select id="chStatus"><option value="pending">\u5F85\u5BA1</option><option value="approved">\u5DF2\u901A\u8FC7</option><option value="rejected">\u5DF2\u62D2\u7EDD</option><option value="">\u5168\u90E8</option></select>
    <button onclick="listChannels()">\u5237\u65B0</button>
  </div>
  <pre id="chOut">\u2014</pre>
  <div id="chActions"></div>

  <h2>\u5185\u5BB9\u5E93\u6982\u51B5</h2>
  <div class="row"><button onclick="loadContentStats()">\u52A0\u8F7D\u7EDF\u8BA1</button></div>
  <pre id="contentOut">\u2014</pre>
</section>

<section id="tab-settings" class="panel">
  <h2>\u654F\u611F\u5185\u5BB9\u8FC7\u6EE4\uFF08\u5168\u5C40\u5F00\u5173\uFF0C\u5BA2\u6237\u7AEF\u65E0\u611F\uFF1B\u9ED8\u8BA4\u5F00\uFF09</h2>
  <div class="row">
    <label><input id="fsOn" type="checkbox" style="vertical-align:middle"> \u8FC7\u6EE4\u654F\u611F\u8BDD\u9898\uFF08\u65B0\u95FB/\u653F\u6CBB/\u610F\u8BC6\u5F62\u6001\uFF09</label>
    <button onclick="saveFilterSensitive()">\u4FDD\u5B58</button>
    <span id="fsMsg"></span>
  </div>

  <h2>\u516C\u544A\u6587\u6848\uFF08\u53CC\u7AEF\u300C\u6211\u7684\u300D\u9875\u5E95\u90E8\u80F6\u56CA\u5757\uFF1B\u7559\u7A7A\u5219\u9690\u85CF\uFF09</h2>
  <div class="row">
    <textarea id="announceText" rows="4" style="width:100%; background:#1c1c1c; color:#eee; border:1px solid #444; border-radius:6px; padding:8px; font:inherit" placeholder="\u4F8B\uFF1A\u8D2D\u4E70\u5361\u5BC6\u52A0\u5FAE\u4FE1 xxx\uFF0C\u6216\u5E97\u94FA\u94FE\u63A5\u2026\uFF08\u9650 500 \u5B57\uFF09"></textarea>
  </div>
  <div class="row">
    <button onclick="saveAnnounce()">\u4FDD\u5B58</button>
    <button onclick="loadSettings()">\u8BFB\u53D6\u5F53\u524D</button>
    <span id="announceMsg"></span>
  </div>

  <h2>\u79BB\u7EBF\u5BBD\u9650\u5929\u6570\uFF08graceDays\uFF0C0\u201390\uFF09</h2>
  <div class="row">
    <input id="graceDays" type="number" min="0" max="90" style="width:80px"> \u5929
    <button onclick="saveGraceDays()">\u4FDD\u5B58</button>
    <span id="graceMsg"></span>
  </div>
</section>

<script>
var tokInput = document.getElementById('tok')
tokInput.value = localStorage.getItem('ytensub_admin_token') || ''
function saveTok() {
  localStorage.setItem('ytensub_admin_token', tokInput.value.trim())
  document.getElementById('tokMsg').textContent = '\u5DF2\u4FDD\u5B58'
  setTimeout(function () { document.getElementById('tokMsg').textContent = '' }, 1500)
}
function switchTab(name) {
  var panels = document.querySelectorAll('.panel')
  for (var i = 0; i < panels.length; i++) panels[i].classList.toggle('on', panels[i].id === 'tab-' + name)
  var btns = document.querySelectorAll('.tabs button')
  for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j].getAttribute('data-tab') === name)
}
async function api(path, opts) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokInput.value.trim() }
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status + ' ' + (data.error || ''))
  return data
}
function show(id, data, isErr) {
  const el = document.getElementById(id)
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  el.className = isErr ? 'err' : ''
}
function flash(id, text, isErr) {
  const el = document.getElementById(id)
  el.textContent = text
  el.className = isErr ? 'err' : 'ok'
  setTimeout(function () { el.textContent = ''; el.className = '' }, 2500)
}
function el(tag, text) {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  return e
}
function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '\u2014' }
function fmtFilter(user, ent) {
  return (ent.filterSensitive ? '\u5F00' : '\u5173') + ' \xB7 ' +
    (user.filterSensitive === true ? '\u5F3A\u5236\u5F00' : user.filterSensitive === false ? '\u5F3A\u5236\u5173' : '\u8DDF\u968F\u5168\u5C40')
}

// ---------- \u4F1A\u5458\u7BA1\u7406 ----------
var usersCache = []
var selectedEmail = ''
async function fetchUsers() {
  const d = await api('/admin/users?limit=200')
  usersCache = d.users || []
  return usersCache
}
async function listUsers() {
  try {
    const users = await fetchUsers()
    const body = document.getElementById('usersBody')
    body.innerHTML = ''
    users.forEach(function (entry) {
      const tr = document.createElement('tr')
      tr.appendChild(el('td', entry.user.email))
      tr.appendChild(el('td', entry.entitlement.plan))
      tr.appendChild(el('td', fmtTime(entry.entitlement.expiresAt)))
      tr.appendChild(el('td', fmtFilter(entry.user, entry.entitlement)))
      const op = document.createElement('td')
      const btn = el('button', '\u9009\u4E2D')
      btn.onclick = function () { selectMember(entry) }
      op.appendChild(btn)
      tr.appendChild(op)
      body.appendChild(tr)
    })
    document.getElementById('usersTable').style.display = users.length ? '' : 'none'
    flash('usersMsg', users.length ? ('\u5171 ' + users.length + ' \u6761') : '\uFF08\u7A7A\uFF09', false)
  } catch (e) { flash('usersMsg', String(e), true) }
}
function selectMember(entry) {
  selectedEmail = entry.user.email
  document.getElementById('qemail').value = selectedEmail
  document.getElementById('benchEmpty').style.display = 'none'
  document.getElementById('bench').style.display = 'block'
  document.getElementById('benchEmail').textContent = selectedEmail
  document.getElementById('ufMode').value =
    entry.user.filterSensitive === true ? 'on' : entry.user.filterSensitive === false ? 'off' : 'inherit'
  renderBenchInfo(entry.user, entry.entitlement)
}
function renderBenchInfo(user, ent) {
  show('benchInfo', {
    email: user.email, \u5B58\u50A8\u6863\u4F4D: user.plan,
    \u5230\u671F: fmtTime(user.expiresAt),
    \u751F\u6548\u6863\u4F4D: ent.plan, \u5BBD\u9650\u5929\u6570: ent.graceDays,
    \u654F\u611F\u8FC7\u6EE4: ent.filterSensitive ? '\u5F00' : '\u5173',
    \u7528\u6237\u7EA7\u8986\u76D6: user.filterSensitive === true ? '\u5F3A\u5236\u5F00' : user.filterSensitive === false ? '\u5F3A\u5236\u5173' : '\u8DDF\u968F\u5168\u5C40'
  })
}
async function lookupUser() {
  try {
    const email = document.getElementById('qemail').value.trim()
    const d = await api('/admin/user?email=' + encodeURIComponent(email))
    if (!d.user) return flash('queryMsg', '\u7528\u6237\u4E0D\u5B58\u5728', true)
    selectMember({ user: d.user, entitlement: d.entitlement })
    flash('queryMsg', '\u5DF2\u9009\u4E2D', false)
  } catch (e) { flash('queryMsg', String(e), true) }
}
async function grantUserPlan() {
  if (!selectedEmail) return
  try {
    const d = await api('/admin/user/plan', {
      method: 'POST',
      body: JSON.stringify({
        email: selectedEmail,
        plan: document.getElementById('grantPlan').value,
        days: +document.getElementById('grantDays').value
      })
    })
    flash('grantMsg', '\u5DF2\u5F00\u901A/\u987A\u5EF6', false)
    if (d.entitlement) {
      const u = { email: selectedEmail, plan: d.entitlement.plan, expiresAt: d.entitlement.expiresAt, filterSensitive: modeToFilter() }
      renderBenchInfo(u, d.entitlement)
    }
  } catch (e) { flash('grantMsg', String(e), true) }
}
async function revokeUserPlan() {
  if (!selectedEmail) return
  if (!confirm('\u786E\u8BA4\u540A\u9500 ' + selectedEmail + ' \u7684\u6743\u76CA\uFF1F\uFF08\u6863\u4F4D\u56DE\u843D free\uFF09')) return
  try {
    const d = await api('/admin/user/plan', {
      method: 'POST',
      body: JSON.stringify({ email: selectedEmail, plan: 'free' })
    })
    flash('revokeMsg', '\u5DF2\u540A\u9500', false)
    if (d.entitlement) {
      const u = { email: selectedEmail, plan: 'free', expiresAt: d.entitlement.expiresAt, filterSensitive: modeToFilter() }
      renderBenchInfo(u, d.entitlement)
    }
  } catch (e) { flash('revokeMsg', String(e), true) }
}
function modeToFilter() {
  const m = document.getElementById('ufMode').value
  return m === 'on' ? true : m === 'off' ? false : null
}
async function saveUserFilter() {
  if (!selectedEmail) return
  try {
    const d = await api('/admin/user/filter', {
      method: 'POST',
      body: JSON.stringify({ email: selectedEmail, mode: document.getElementById('ufMode').value })
    })
    flash('ufMsg', '\u5DF2\u4FDD\u5B58\uFF08' + (d.filterSensitive === null ? '\u8DDF\u968F\u5168\u5C40' : d.filterSensitive ? '\u5F3A\u5236\u5F00' : '\u5F3A\u5236\u5173') + '\uFF09', false)
  } catch (e) { flash('ufMsg', String(e), true) }
}

// ---------- \u8BA2\u9605\u7BA1\u7406 ----------
async function genCards() {
  try {
    const d = await api('/admin/cards', {
      method: 'POST',
      body: JSON.stringify({
        plan: document.getElementById('plan').value,
        days: +document.getElementById('days').value,
        count: +document.getElementById('count').value
      })
    })
    show('genOut', d.codes.join('\\n'))
  } catch (e) { show('genOut', String(e), true) }
}
async function listCards() {
  try {
    const d = await api('/admin/cards?limit=100')
    const body = document.getElementById('cardsBody')
    body.innerHTML = ''
    ;(d.cards || []).forEach(function (c) {
      const tr = document.createElement('tr')
      tr.appendChild(el('td', c.code))
      tr.appendChild(el('td', c.plan))
      tr.appendChild(el('td', c.days + 'd'))
      const status = el('td', c.usedAt ? ('\u5DF2\u7528 ' + (c.usedBy || '') + '  ' + fmtTime(c.usedAt)) : '\u672A\u7528')
      if (c.usedAt) status.className = 'used'
      tr.appendChild(status)
      const op = document.createElement('td')
      if (!c.usedAt) {
        const btn = el('button', '\u540A\u9500')
        btn.onclick = function () { revokeCard(c.code) }
        op.appendChild(btn)
      }
      tr.appendChild(op)
      body.appendChild(tr)
    })
    document.getElementById('cardsTable').style.display = (d.cards && d.cards.length) ? '' : 'none'
    flash('cardsMsg', (d.cards && d.cards.length) ? ('\u5171 ' + d.cards.length + ' \u6761') : '\uFF08\u7A7A\uFF09', false)
  } catch (e) { flash('cardsMsg', String(e), true) }
}
async function revokeCard(code) {
  if (!confirm('\u786E\u8BA4\u540A\u9500\u5361\u5BC6 ' + code + '\uFF1F\uFF08\u672A\u4F7F\u7528\u7684\u624D\u4F1A\u6210\u529F\uFF09')) return
  try {
    await api('/admin/cards/revoke', { method: 'POST', body: JSON.stringify({ code: code }) })
    flash('cardsMsg', '\u5DF2\u540A\u9500 ' + code, false)
    listCards()
  } catch (e) { flash('cardsMsg', String(e), true) }
}
async function listExpiring() {
  try {
    const users = await fetchUsers()
    const now = Date.now()
    const soon = now + 30 * 864e5
    const rows = users.filter(function (e) {
      return e.entitlement.plan !== 'free' && e.entitlement.expiresAt &&
        e.entitlement.expiresAt > now && e.entitlement.expiresAt <= soon
    }).sort(function (a, b) { return a.entitlement.expiresAt - b.entitlement.expiresAt })
    const body = document.getElementById('expBody')
    body.innerHTML = ''
    rows.forEach(function (e) {
      const tr = document.createElement('tr')
      tr.appendChild(el('td', e.user.email))
      tr.appendChild(el('td', e.entitlement.plan))
      tr.appendChild(el('td', fmtTime(e.entitlement.expiresAt)))
      tr.appendChild(el('td', Math.ceil((e.entitlement.expiresAt - now) / 864e5) + ' \u5929'))
      body.appendChild(tr)
    })
    document.getElementById('expTable').style.display = rows.length ? '' : 'none'
    flash('expMsg', rows.length ? ('\u5171 ' + rows.length + ' \u6761') : '30 \u5929\u5185\u65E0\u5230\u671F', false)
  } catch (e) { flash('expMsg', String(e), true) }
}

// ---------- \u5185\u5BB9\u7BA1\u7406 ----------
async function listChannels() {
  try {
    const s = document.getElementById('chStatus').value
    const d = await api('/admin/channels' + (s ? '?status=' + s : ''))
    show('chOut', d.channels.map(function (c) {
      return c.handle + '  [' + c.status + ']  ' + c.submittedBy + '  ' + new Date(c.submittedAt).toLocaleString()
    }).join('\\n') || '\uFF08\u7A7A\uFF09')
    // \u5F85\u5BA1\u6761\u76EE\u7ED9\u901A\u8FC7/\u62D2\u7EDD\u6309\u94AE
    document.getElementById('chActions').innerHTML = ''
    d.channels.filter(function (c) { return c.status === 'pending' }).forEach(function (c) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('span')
      label.textContent = c.handle
      const ok = document.createElement('button')
      ok.textContent = '\u901A\u8FC7'
      ok.onclick = function () { decide(c.handle, 'approved') }
      const no = document.createElement('button')
      no.textContent = '\u62D2\u7EDD'
      no.onclick = function () { decide(c.handle, 'rejected') }
      row.append(label, ok, no)
      document.getElementById('chActions').appendChild(row)
    })
  } catch (e) { show('chOut', String(e), true) }
}
async function decide(handle, status) {
  try {
    await api('/admin/channels/decide', { method: 'POST', body: JSON.stringify({ handle: handle, status: status }) })
    listChannels()
  } catch (e) { show('chOut', String(e), true) }
}
async function loadContentStats() {
  try {
    const r = await fetch('https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/content-db.json')
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText)
    const db = await r.json()
    const videos = Object.values(db.videos ?? db)
    const levels = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }
    let other = 0
    const tagCount = {}
    let latest = 0
    videos.forEach(function (v) {
      const lv = String(v.level || '').toUpperCase()
      if (lv in levels) levels[lv]++; else other++
      ;(v.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1 })
      const t = new Date(v.fetchedAt || 0).getTime()
      if (!isNaN(t) && t > latest) latest = t
    })
    const top = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a] }).slice(0, 10)
    const tagLines = {}
    top.forEach(function (t) { tagLines[t] = tagCount[t] })
    show('contentOut', {
      \u603B\u6761\u76EE: videos.length,
      \u6309level\u5206\u5E03: {
        A1: levels.A1, A2: levels.A2, B1: levels.B1, B2: levels.B2, C1: levels.C1, C2: levels.C2,
        \u5176\u4ED6\u6216\u7F3A\u5931: other
      },
      \u6807\u7B7Etop10: tagLines,
      \u6700\u65B0\u6293\u53D6: latest ? new Date(latest).toLocaleString() : '\u2014'
    })
  } catch (e) { show('contentOut', String(e), true) }
}

// ---------- \u8BBE\u7F6E ----------
async function loadSettings() {
  try {
    const d = await api('/admin/config')
    document.getElementById('graceDays').value = d.graceDays
    document.getElementById('fsOn').checked = !!d.filterSensitive
    document.getElementById('announceText').value = d.announce || ''
  } catch (e) { flash('graceMsg', String(e), true) }
}
async function saveGraceDays() {
  try {
    const d = await api('/admin/config/grace-days', {
      method: 'POST',
      body: JSON.stringify({ days: +document.getElementById('graceDays').value })
    })
    flash('graceMsg', '\u5DF2\u4FDD\u5B58\uFF08' + d.graceDays + ' \u5929\uFF09', false)
  } catch (e) { flash('graceMsg', String(e), true) }
}
async function saveAnnounce() {
  try {
    await api('/admin/announce', {
      method: 'POST',
      body: JSON.stringify({ text: document.getElementById('announceText').value })
    })
    flash('announceMsg', '\u5DF2\u4FDD\u5B58', false)
  } catch (e) { flash('announceMsg', String(e), true) }
}
async function saveFilterSensitive() {
  try {
    await api('/admin/filter-sensitive', {
      method: 'POST',
      body: JSON.stringify({ on: document.getElementById('fsOn').checked })
    })
    flash('fsMsg', '\u5DF2\u4FDD\u5B58', false)
  } catch (e) { flash('fsMsg', String(e), true) }
}
loadSettings()
<\/script>
</body>
</html>`;

// src/index.ts
var CODE_TTL_S = 600;
var TOKEN_TTL_S = 30 * 86400;
var DEFAULT_GRACE_DAYS = 7;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
__name(json, "json");
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(cors, "cors");
function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1].trim() : null;
}
__name(bearer, "bearer");
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
async function graceDays(env) {
  const v = await env.YTENSUB_KV.get("config:graceDays");
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 90 ? n : DEFAULT_GRACE_DAYS;
}
__name(graceDays, "graceDays");
async function globalFilterSensitive(env) {
  return await env.YTENSUB_KV.get("config:filter-sensitive") !== "0";
}
__name(globalFilterSensitive, "globalFilterSensitive");
async function getUser(env, email) {
  return await env.YTENSUB_KV.get(`user:${email}`, "json");
}
__name(getUser, "getUser");
async function authUser(env, req) {
  const token = bearer(req);
  if (!token) return null;
  const email = await env.YTENSUB_KV.get(`token:${token}`);
  if (!email) return null;
  await env.YTENSUB_KV.put(`token:${token}`, email, { expirationTtl: TOKEN_TTL_S });
  return getUser(env, email);
}
__name(authUser, "authUser");
async function sendCodeEmail(env, email, code) {
  if (!env.EMAIL_FROM) return false;
  const subject = `YTenSUB \u9A8C\u8BC1\u7801\uFF1A${code}`;
  const text = `\u60A8\u7684 YTenSUB \u767B\u5F55\u9A8C\u8BC1\u7801\u662F ${code}\uFF0C10 \u5206\u949F\u5185\u6709\u6548\u3002\u82E5\u975E\u672C\u4EBA\u64CD\u4F5C\u8BF7\u5FFD\u7565\u3002`;
  switch (chooseMailProvider(env)) {
    case "resend": {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: email, subject, text })
      });
      return r.ok;
    }
    case "sendgrid": {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: env.EMAIL_FROM },
          subject,
          content: [{ type: "text/plain", value: text }]
        })
      });
      return r.ok || r.status === 202;
    }
    default:
      return false;
  }
}
__name(sendCodeEmail, "sendCodeEmail");
async function handleAuthCode(env, req) {
  const body = await readJson(req);
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!isValidEmail(email)) return json({ error: "invalid email" }, 400);
  if (await env.YTENSUB_KV.get(`rl:code:${email}`)) {
    return json({ error: "too frequent, retry in 60s" }, 429);
  }
  const code = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  await env.YTENSUB_KV.put(`code:${email}`, JSON.stringify({ code }), { expirationTtl: CODE_TTL_S });
  await env.YTENSUB_KV.put(`rl:code:${email}`, "1", { expirationTtl: 60 });
  const sent = await sendCodeEmail(env, email, code);
  if (!sent && env.DEV_MODE !== "true") return json({ error: "email not configured" }, 500);
  return json(env.DEV_MODE === "true" ? { ok: true, devCode: code } : { ok: true });
}
__name(handleAuthCode, "handleAuthCode");
async function handleLogin(env, req) {
  const body = await readJson(req);
  const email = body?.email?.trim().toLowerCase() ?? "";
  const code = body?.code?.trim() ?? "";
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return json({ error: "bad request" }, 400);
  const stored = await env.YTENSUB_KV.get(`code:${email}`, "json");
  if (!stored || stored.code !== code) return json({ error: "wrong or expired code" }, 401);
  await env.YTENSUB_KV.delete(`code:${email}`);
  const now = Date.now();
  let user = await getUser(env, email);
  if (!user) {
    user = { email, plan: "free", expiresAt: null, createdAt: now, updatedAt: now };
    await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(user));
  }
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await env.YTENSUB_KV.put(`token:${token}`, email, { expirationTtl: TOKEN_TTL_S });
  return json({ token, entitlement: toEntitlement(user, now, await graceDays(env), await globalFilterSensitive(env)) });
}
__name(handleLogin, "handleLogin");
async function handleRedeem(env, req) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await readJson(req);
  const code = normalizeCardCode(body?.code ?? "");
  if (!isValidCardCode(code)) return json({ error: "bad code format" }, 400);
  const card = await env.YTENSUB_KV.get(`card:${code}`, "json");
  if (!card) return json({ error: "card not found" }, 404);
  if (card.usedAt) return json({ error: "card already used" }, 409);
  const now = Date.now();
  const updated = applyCard(user, card, now);
  card.usedBy = user.email;
  card.usedAt = now;
  await env.YTENSUB_KV.put(`user:${user.email}`, JSON.stringify(updated));
  await env.YTENSUB_KV.put(`card:${code}`, JSON.stringify(card));
  return json({ entitlement: toEntitlement(updated, now, await graceDays(env), await globalFilterSensitive(env)) });
}
__name(handleRedeem, "handleRedeem");
async function handleEntitlement(env, req) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  return json({ entitlement: toEntitlement(user, Date.now(), await graceDays(env), await globalFilterSensitive(env)) });
}
__name(handleEntitlement, "handleEntitlement");
async function handlePrefsGet(env, req) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const prefs = await env.YTENSUB_KV.get(`pref:${user.email}`, "json");
  return json({ prefs });
}
__name(handlePrefsGet, "handlePrefsGet");
async function handlePrefsPut(env, req) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (effectivePlan(user, Date.now()) === "free") return json({ error: "pro feature" }, 403);
  const prefs = sanitizePrefs(await readJson(req), Date.now());
  if (!prefs) return json({ error: "bad prefs" }, 400);
  const cur = await env.YTENSUB_KV.get(`pref:${user.email}`, "json");
  const merged = mergePrefs(prefs, cur);
  await env.YTENSUB_KV.put(`pref:${user.email}`, JSON.stringify(merged));
  return json({ prefs: merged });
}
__name(handlePrefsPut, "handlePrefsPut");
async function handleChannelSubmit(env, req) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (effectivePlan(user, Date.now()) === "free") return json({ error: "pro feature" }, 403);
  const body = await readJson(req);
  const handle = normalizeChannelHandle(body?.handle ?? "");
  if (!handle) return json({ error: "bad channel handle" }, 400);
  const key = `uchan:${handle}`;
  const cur = await env.YTENSUB_KV.get(key, "json");
  if (cur?.status === "approved") return json({ ok: true, status: "approved" });
  const rec = { handle, submittedBy: user.email, submittedAt: Date.now(), status: "pending" };
  await env.YTENSUB_KV.put(key, JSON.stringify(rec));
  return json({ ok: true, status: "pending" });
}
__name(handleChannelSubmit, "handleChannelSubmit");
async function handleAdminChannelsList(env, req) {
  const status = new URL(req.url).searchParams.get("status");
  const list = await env.YTENSUB_KV.list({ prefix: "uchan:", limit: 500 });
  const channels = [];
  for (const k of list.keys) {
    const c = await env.YTENSUB_KV.get(k.name, "json");
    if (c && (!status || c.status === status)) channels.push(c);
  }
  channels.sort((a, b) => b.submittedAt - a.submittedAt);
  return json({ channels });
}
__name(handleAdminChannelsList, "handleAdminChannelsList");
async function handleAdminChannelDecide(env, req) {
  const body = await readJson(req);
  const handle = normalizeChannelHandle(body?.handle ?? "");
  const status = body?.status === "approved" || body?.status === "rejected" ? body.status : null;
  if (!handle || !status) return json({ error: "bad request" }, 400);
  const key = `uchan:${handle}`;
  const cur = await env.YTENSUB_KV.get(key, "json");
  if (!cur) return json({ error: "not found" }, 404);
  cur.status = status;
  await env.YTENSUB_KV.put(key, JSON.stringify(cur));
  return json({ ok: true });
}
__name(handleAdminChannelDecide, "handleAdminChannelDecide");
async function handleCues(env, req, videoId) {
  const user = await authUser(env, req);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (effectivePlan(user, Date.now()) !== "pro_plus") return json({ error: "pro_plus feature" }, 403);
  if (!isValidVideoId(videoId)) return json({ error: "bad videoId" }, 400);
  const base = env.CUES_BASE_URL ?? "https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/cues/";
  const upstream = await fetch(`${base}${videoId}.json`);
  if (!upstream.ok) return json({ error: "cues not found" }, 404);
  return new Response(upstream.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600", ...cors() }
  });
}
__name(handleCues, "handleCues");
async function handleAnnounceGet(env) {
  const text = await env.YTENSUB_KV.get("config:announce");
  return json({ text: text ?? "" });
}
__name(handleAnnounceGet, "handleAnnounceGet");
async function handleFilterSensitiveGet(env) {
  const v = await env.YTENSUB_KV.get("config:filter-sensitive");
  return json({ on: v !== "0" });
}
__name(handleFilterSensitiveGet, "handleFilterSensitiveGet");
async function handleAdminFilterSensitiveSet(env, req) {
  const body = await readJson(req);
  if (typeof body?.on !== "boolean") return json({ error: "bad request" }, 400);
  await env.YTENSUB_KV.put("config:filter-sensitive", body.on ? "1" : "0");
  return json({ ok: true, on: body.on });
}
__name(handleAdminFilterSensitiveSet, "handleAdminFilterSensitiveSet");
async function handleAdminAnnounceSet(env, req) {
  const body = await readJson(req);
  if (typeof body?.text !== "string") return json({ error: "bad request" }, 400);
  const text = sanitizeAnnounce(body.text);
  await env.YTENSUB_KV.put("config:announce", text ?? "");
  return json({ ok: true, text: text ?? "" });
}
__name(handleAdminAnnounceSet, "handleAdminAnnounceSet");
function adminOk(env, req) {
  const token = bearer(req);
  return !!env.ADMIN_TOKEN && !!token && token === env.ADMIN_TOKEN;
}
__name(adminOk, "adminOk");
async function handleAdminCardsCreate(env, req) {
  const body = await readJson(req);
  const plan = body?.plan === "pro_plus" ? "pro_plus" : body?.plan === "pro" ? "pro" : null;
  const days = Math.floor(body?.days ?? 0);
  const count = Math.min(Math.max(Math.floor(body?.count ?? 1), 1), 100);
  if (!plan || days <= 0 || days > 3650) return json({ error: "bad plan/days" }, 400);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = makeCardCode(Math.random);
    const card = { code, plan, days };
    await env.YTENSUB_KV.put(`card:${code}`, JSON.stringify(card));
    codes.push(code);
  }
  return json({ codes });
}
__name(handleAdminCardsCreate, "handleAdminCardsCreate");
async function handleAdminCardsList(env, req) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const list = await env.YTENSUB_KV.list({ prefix: "card:", limit });
  const cards = [];
  for (const k of list.keys) {
    const c = await env.YTENSUB_KV.get(k.name, "json");
    if (c) cards.push(c);
  }
  cards.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
  return json({ cards });
}
__name(handleAdminCardsList, "handleAdminCardsList");
async function handleAdminUserLookup(env, req) {
  const email = (new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return json({ error: "invalid email" }, 400);
  const user = await getUser(env, email);
  if (!user) return json({ user: null });
  return json({ user, entitlement: toEntitlement(user, Date.now(), await graceDays(env), await globalFilterSensitive(env)) });
}
__name(handleAdminUserLookup, "handleAdminUserLookup");
async function handleAdminUserFilterSet(env, req) {
  const body = await readJson(req);
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!isValidEmail(email)) return json({ error: "invalid email" }, 400);
  const mode = body?.mode;
  if (mode !== "inherit" && mode !== "on" && mode !== "off") return json({ error: "bad mode" }, 400);
  const user = await getUser(env, email);
  if (!user) return json({ error: "user not found" }, 404);
  user.filterSensitive = mode === "inherit" ? null : mode === "on";
  user.updatedAt = Date.now();
  await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(user));
  return json({ ok: true, filterSensitive: user.filterSensitive });
}
__name(handleAdminUserFilterSet, "handleAdminUserFilterSet");
async function handleAdminUsersList(env, req) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 500);
  const list = await env.YTENSUB_KV.list({ prefix: "user:", limit });
  const gd = await graceDays(env);
  const gfs = await globalFilterSensitive(env);
  const now = Date.now();
  const users = [];
  for (const k of list.keys) {
    const u = await env.YTENSUB_KV.get(k.name, "json");
    if (u) users.push({ user: u, entitlement: toEntitlement(u, now, gd, gfs) });
  }
  users.sort((a, b) => (b.entitlement.expiresAt ?? 0) - (a.entitlement.expiresAt ?? 0));
  return json({ users });
}
__name(handleAdminUsersList, "handleAdminUsersList");
async function handleAdminUserPlanSet(env, req) {
  const body = await readJson(req);
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!isValidEmail(email)) return json({ error: "invalid email" }, 400);
  const user = await getUser(env, email);
  if (!user) return json({ error: "user not found" }, 404);
  const now = Date.now();
  let updated;
  if (body?.plan === "free") {
    updated = revokePlan(user, now);
  } else if (body?.plan === "pro" || body?.plan === "pro_plus") {
    const days = Math.floor(body?.days ?? 0);
    if (days <= 0 || days > 3650) return json({ error: "bad days" }, 400);
    updated = grantPlan(user, body.plan, days, now);
  } else {
    return json({ error: "bad plan" }, 400);
  }
  await env.YTENSUB_KV.put(`user:${email}`, JSON.stringify(updated));
  return json({
    ok: true,
    entitlement: toEntitlement(updated, now, await graceDays(env), await globalFilterSensitive(env))
  });
}
__name(handleAdminUserPlanSet, "handleAdminUserPlanSet");
async function handleAdminCardRevoke(env, req) {
  const body = await readJson(req);
  const code = normalizeCardCode(body?.code ?? "");
  if (!isValidCardCode(code)) return json({ error: "bad code format" }, 400);
  const key = `card:${code}`;
  const card = await env.YTENSUB_KV.get(key, "json");
  if (!card) return json({ error: "not found" }, 404);
  if (card.usedAt) return json({ error: "card already used, keep for record" }, 409);
  await env.YTENSUB_KV.delete(key);
  return json({ ok: true });
}
__name(handleAdminCardRevoke, "handleAdminCardRevoke");
async function handleAdminConfigGet(env) {
  return json({
    graceDays: await graceDays(env),
    filterSensitive: await globalFilterSensitive(env),
    announce: await env.YTENSUB_KV.get("config:announce") ?? ""
  });
}
__name(handleAdminConfigGet, "handleAdminConfigGet");
async function handleAdminGraceDaysSet(env, req) {
  const body = await readJson(req);
  const days = Math.floor(body?.days ?? NaN);
  if (!Number.isFinite(days) || days < 0 || days > 90) return json({ error: "days 0-90" }, 400);
  await env.YTENSUB_KV.put("config:graceDays", String(days));
  return json({ ok: true, graceDays: days });
}
__name(handleAdminGraceDaysSet, "handleAdminGraceDaysSet");
var src_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      if (pathname === "/health") return json({ ok: true });
      if (pathname === "/announce" && req.method === "GET") return await handleAnnounceGet(env);
      if (pathname === "/config/filter-sensitive" && req.method === "GET") {
        return await handleFilterSensitiveGet(env);
      }
      if (pathname === "/auth/code" && req.method === "POST") return await handleAuthCode(env, req);
      if (pathname === "/auth/login" && req.method === "POST") return await handleLogin(env, req);
      if (pathname === "/redeem" && req.method === "POST") return await handleRedeem(env, req);
      if (pathname === "/me/entitlement" && req.method === "GET") return await handleEntitlement(env, req);
      if (pathname === "/me/prefs" && req.method === "GET") return await handlePrefsGet(env, req);
      if (pathname === "/me/prefs" && req.method === "PUT") return await handlePrefsPut(env, req);
      if (pathname === "/channels/submit" && req.method === "POST") return await handleChannelSubmit(env, req);
      const cuesMatch = /^\/cues\/([\w-]{11})$/.exec(pathname);
      if (cuesMatch && req.method === "GET") return await handleCues(env, req, cuesMatch[1]);
      if (pathname === "/admin" && req.method === "GET") {
        return new Response(ADMIN_PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...cors() }
        });
      }
      if (pathname === "/admin/cards" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminCardsCreate(env, req);
      }
      if (pathname === "/admin/cards" && req.method === "GET") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminCardsList(env, req);
      }
      if (pathname === "/admin/user" && req.method === "GET") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminUserLookup(env, req);
      }
      if (pathname === "/admin/channels" && req.method === "GET") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminChannelsList(env, req);
      }
      if (pathname === "/admin/channels/decide" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminChannelDecide(env, req);
      }
      if (pathname === "/admin/announce" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminAnnounceSet(env, req);
      }
      if (pathname === "/admin/filter-sensitive" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminFilterSensitiveSet(env, req);
      }
      if (pathname === "/admin/user/filter" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminUserFilterSet(env, req);
      }
      if (pathname === "/admin/users" && req.method === "GET") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminUsersList(env, req);
      }
      if (pathname === "/admin/user/plan" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminUserPlanSet(env, req);
      }
      if (pathname === "/admin/cards/revoke" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminCardRevoke(env, req);
      }
      if (pathname === "/admin/config" && req.method === "GET") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminConfigGet(env);
      }
      if (pathname === "/admin/config/grace-days" && req.method === "POST") {
        if (!adminOk(env, req)) return json({ error: "unauthorized" }, 401);
        return await handleAdminGraceDaysSet(env, req);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "internal", detail: String(e) }, 500);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-fdkg8K/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-fdkg8K/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map

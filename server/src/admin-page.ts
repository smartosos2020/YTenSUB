/**
 * A4 极简管理页：纯静态 HTML（无框架），挂在 Worker /admin 路由上。
 * token 仅存在访问者浏览器 localStorage，页面本身不鉴权（接口全部要 admin token）。
 * 四个 tab：会员管理 / 订阅管理 / 内容管理 / 设置（纯前端 display 切换）。
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YTenSUB 管理</title>
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
<h1>YTenSUB 管理</h1>
<div class="row">
  <input id="tok" type="password" placeholder="admin token" size="40">
  <button onclick="saveTok()">保存 token</button>
  <span id="tokMsg"></span>
</div>

<div class="tabs">
  <button data-tab="members" class="on" onclick="switchTab('members')">会员管理</button>
  <button data-tab="subs" onclick="switchTab('subs')">订阅管理</button>
  <button data-tab="content" onclick="switchTab('content')">内容管理</button>
  <button data-tab="settings" onclick="switchTab('settings')">设置</button>
</div>

<section id="tab-members" class="panel on">
  <h2>会员列表</h2>
  <div class="row"><button onclick="listUsers()">刷新</button><span id="usersMsg"></span></div>
  <table id="usersTable" style="display:none">
    <thead><tr><th>email</th><th>生效档位</th><th>到期时间</th><th>敏感过滤</th><th>操作</th></tr></thead>
    <tbody id="usersBody"></tbody>
  </table>

  <h2>按邮箱查询</h2>
  <div class="row">
    <input id="qemail" type="email" placeholder="user@example.com" size="30">
    <button onclick="lookupUser()">查询并选中</button>
    <span id="queryMsg"></span>
  </div>

  <h2>操作台</h2>
  <div class="row" id="benchEmpty">未选中会员：在上方列表点「选中」，或按邮箱查询。</div>
  <div id="bench" style="display:none">
    <div class="row"><span>当前选中：</span><b id="benchEmail"></b></div>
    <pre id="benchInfo">—</pre>
    <div class="row">
      <span>开通/顺延：</span>
      <select id="grantPlan"><option value="pro">pro</option><option value="pro_plus">pro_plus</option></select>
      <input id="grantDays" type="number" value="365" min="1" max="3650" style="width:80px"> 天
      <button onclick="grantUserPlan()">执行</button>
      <span id="grantMsg"></span>
    </div>
    <div class="row">
      <button onclick="revokeUserPlan()">吊销权益</button>
      <span id="revokeMsg"></span>
    </div>
    <div class="row">
      <span>敏感过滤覆盖：</span>
      <select id="ufMode"><option value="inherit">跟随全局</option><option value="on">强制开</option><option value="off">强制关</option></select>
      <button onclick="saveUserFilter()">保存</button>
      <span id="ufMsg"></span>
    </div>
  </div>
</section>

<section id="tab-subs" class="panel">
  <h2>生成卡密</h2>
  <div class="row">
    <select id="plan"><option value="pro">pro</option><option value="pro_plus">pro_plus</option></select>
    <input id="days" type="number" value="365" min="1" max="3650" style="width:80px"> 天
    <input id="count" type="number" value="5" min="1" max="100" style="width:70px"> 张
    <button onclick="genCards()">生成</button>
  </div>
  <pre id="genOut">—</pre>

  <h2>卡密列表（最近 100 条）</h2>
  <div class="row"><button onclick="listCards()">刷新</button><span id="cardsMsg"></span></div>
  <table id="cardsTable" style="display:none">
    <thead><tr><th>卡密</th><th>档位</th><th>天数</th><th>状态</th><th>操作</th></tr></thead>
    <tbody id="cardsBody"></tbody>
  </table>

  <h2>近期到期（30 天内的付费会员）</h2>
  <div class="row"><button onclick="listExpiring()">刷新</button><span id="expMsg"></span></div>
  <table id="expTable" style="display:none">
    <thead><tr><th>email</th><th>档位</th><th>到期时间</th><th>剩余</th></tr></thead>
    <tbody id="expBody"></tbody>
  </table>
</section>

<section id="tab-content" class="panel">
  <h2>用户频道审核（C1）</h2>
  <div class="row">
    <select id="chStatus"><option value="pending">待审</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="">全部</option></select>
    <button onclick="listChannels()">刷新</button>
  </div>
  <pre id="chOut">—</pre>
  <div id="chActions"></div>

  <h2>内容库概况</h2>
  <div class="row"><button onclick="loadContentStats()">加载统计</button></div>
  <pre id="contentOut">—</pre>
</section>

<section id="tab-settings" class="panel">
  <h2>敏感内容过滤（全局开关，客户端无感；默认开）</h2>
  <div class="row">
    <label><input id="fsOn" type="checkbox" style="vertical-align:middle"> 过滤敏感话题（新闻/政治/意识形态）</label>
    <button onclick="saveFilterSensitive()">保存</button>
    <span id="fsMsg"></span>
  </div>

  <h2>公告文案（双端「我的」页底部胶囊块；留空则隐藏）</h2>
  <div class="row">
    <textarea id="announceText" rows="4" style="width:100%; background:#1c1c1c; color:#eee; border:1px solid #444; border-radius:6px; padding:8px; font:inherit" placeholder="例：购买卡密加微信 xxx，或店铺链接…（限 500 字）"></textarea>
  </div>
  <div class="row">
    <button onclick="saveAnnounce()">保存</button>
    <button onclick="loadSettings()">读取当前</button>
    <span id="announceMsg"></span>
  </div>

  <h2>离线宽限天数（graceDays，0–90）</h2>
  <div class="row">
    <input id="graceDays" type="number" min="0" max="90" style="width:80px"> 天
    <button onclick="saveGraceDays()">保存</button>
    <span id="graceMsg"></span>
  </div>
</section>

<script>
var tokInput = document.getElementById('tok')
tokInput.value = localStorage.getItem('ytensub_admin_token') || ''
function saveTok() {
  localStorage.setItem('ytensub_admin_token', tokInput.value.trim())
  document.getElementById('tokMsg').textContent = '已保存'
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
function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '—' }
function fmtFilter(user, ent) {
  return (ent.filterSensitive ? '开' : '关') + ' · ' +
    (user.filterSensitive === true ? '强制开' : user.filterSensitive === false ? '强制关' : '跟随全局')
}

// ---------- 会员管理 ----------
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
      const btn = el('button', '选中')
      btn.onclick = function () { selectMember(entry) }
      op.appendChild(btn)
      tr.appendChild(op)
      body.appendChild(tr)
    })
    document.getElementById('usersTable').style.display = users.length ? '' : 'none'
    flash('usersMsg', users.length ? ('共 ' + users.length + ' 条') : '（空）', false)
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
    email: user.email, 存储档位: user.plan,
    到期: fmtTime(user.expiresAt),
    生效档位: ent.plan, 宽限天数: ent.graceDays,
    敏感过滤: ent.filterSensitive ? '开' : '关',
    用户级覆盖: user.filterSensitive === true ? '强制开' : user.filterSensitive === false ? '强制关' : '跟随全局'
  })
}
async function lookupUser() {
  try {
    const email = document.getElementById('qemail').value.trim()
    const d = await api('/admin/user?email=' + encodeURIComponent(email))
    if (!d.user) return flash('queryMsg', '用户不存在', true)
    selectMember({ user: d.user, entitlement: d.entitlement })
    flash('queryMsg', '已选中', false)
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
    flash('grantMsg', '已开通/顺延', false)
    if (d.entitlement) {
      const u = { email: selectedEmail, plan: d.entitlement.plan, expiresAt: d.entitlement.expiresAt, filterSensitive: modeToFilter() }
      renderBenchInfo(u, d.entitlement)
    }
  } catch (e) { flash('grantMsg', String(e), true) }
}
async function revokeUserPlan() {
  if (!selectedEmail) return
  if (!confirm('确认吊销 ' + selectedEmail + ' 的权益？（档位回落 free）')) return
  try {
    const d = await api('/admin/user/plan', {
      method: 'POST',
      body: JSON.stringify({ email: selectedEmail, plan: 'free' })
    })
    flash('revokeMsg', '已吊销', false)
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
    flash('ufMsg', '已保存（' + (d.filterSensitive === null ? '跟随全局' : d.filterSensitive ? '强制开' : '强制关') + '）', false)
  } catch (e) { flash('ufMsg', String(e), true) }
}

// ---------- 订阅管理 ----------
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
      const status = el('td', c.usedAt ? ('已用 ' + (c.usedBy || '') + '  ' + fmtTime(c.usedAt)) : '未用')
      if (c.usedAt) status.className = 'used'
      tr.appendChild(status)
      const op = document.createElement('td')
      if (!c.usedAt) {
        const btn = el('button', '吊销')
        btn.onclick = function () { revokeCard(c.code) }
        op.appendChild(btn)
      }
      tr.appendChild(op)
      body.appendChild(tr)
    })
    document.getElementById('cardsTable').style.display = (d.cards && d.cards.length) ? '' : 'none'
    flash('cardsMsg', (d.cards && d.cards.length) ? ('共 ' + d.cards.length + ' 条') : '（空）', false)
  } catch (e) { flash('cardsMsg', String(e), true) }
}
async function revokeCard(code) {
  if (!confirm('确认吊销卡密 ' + code + '？（未使用的才会成功）')) return
  try {
    await api('/admin/cards/revoke', { method: 'POST', body: JSON.stringify({ code: code }) })
    flash('cardsMsg', '已吊销 ' + code, false)
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
      tr.appendChild(el('td', Math.ceil((e.entitlement.expiresAt - now) / 864e5) + ' 天'))
      body.appendChild(tr)
    })
    document.getElementById('expTable').style.display = rows.length ? '' : 'none'
    flash('expMsg', rows.length ? ('共 ' + rows.length + ' 条') : '30 天内无到期', false)
  } catch (e) { flash('expMsg', String(e), true) }
}

// ---------- 内容管理 ----------
async function listChannels() {
  try {
    const s = document.getElementById('chStatus').value
    const d = await api('/admin/channels' + (s ? '?status=' + s : ''))
    show('chOut', d.channels.map(function (c) {
      return c.handle + '  [' + c.status + ']  ' + c.submittedBy + '  ' + new Date(c.submittedAt).toLocaleString()
    }).join('\\n') || '（空）')
    // 待审条目给通过/拒绝按钮
    document.getElementById('chActions').innerHTML = ''
    d.channels.filter(function (c) { return c.status === 'pending' }).forEach(function (c) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('span')
      label.textContent = c.handle
      const ok = document.createElement('button')
      ok.textContent = '通过'
      ok.onclick = function () { decide(c.handle, 'approved') }
      const no = document.createElement('button')
      no.textContent = '拒绝'
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
      总条目: videos.length,
      按level分布: {
        A1: levels.A1, A2: levels.A2, B1: levels.B1, B2: levels.B2, C1: levels.C1, C2: levels.C2,
        其他或缺失: other
      },
      标签top10: tagLines,
      最新抓取: latest ? new Date(latest).toLocaleString() : '—'
    })
  } catch (e) { show('contentOut', String(e), true) }
}

// ---------- 设置 ----------
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
    flash('graceMsg', '已保存（' + d.graceDays + ' 天）', false)
  } catch (e) { flash('graceMsg', String(e), true) }
}
async function saveAnnounce() {
  try {
    await api('/admin/announce', {
      method: 'POST',
      body: JSON.stringify({ text: document.getElementById('announceText').value })
    })
    flash('announceMsg', '已保存', false)
  } catch (e) { flash('announceMsg', String(e), true) }
}
async function saveFilterSensitive() {
  try {
    await api('/admin/filter-sensitive', {
      method: 'POST',
      body: JSON.stringify({ on: document.getElementById('fsOn').checked })
    })
    flash('fsMsg', '已保存', false)
  } catch (e) { flash('fsMsg', String(e), true) }
}
loadSettings()
</script>
</body>
</html>`

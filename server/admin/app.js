/**
 * admin/app.js — 运营后台前端逻辑（原生 JS，零构建）
 */
(function () {
  // 云函数 HTTP 触发地址（部署后替换成真实地址）。
  // 本地开发（node app.js）时留空 = 同源 REST；上云后填 https://<envId>-<id>.ap-shanghai.app.tcloudbase.com
  const API_BASE = 'https://minigame-prod-d5g02fq8e40658692-1463521202.ap-shanghai.app.tcloudbase.com';
  const CLOUD_MODE = API_BASE !== ''; // 空 = 本地 REST 模式；非空 = 云函数 HTTP 触发模式

  // ===== 全局错误兜底：抛错时直接弹到页面 + 控制台，绝不静默 =====
  function _bootError(msg) {
    console.error('[TK] boot error:', msg);
    const el = document.getElementById('loginError');
    if (el) el.textContent = '前端初始化失败：' + msg + '（请按 F12 查看 Console）';
  }
  window.addEventListener('error', e => _bootError(e.message + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')));
  window.addEventListener('unhandledrejection', e => _bootError(String(e.reason && e.reason.message || e.reason)));

  let token = null; // 启动时强制清，要求每次重新登录（避免带过期 token 卡住）
  localStorage.removeItem('tk_admin_token');
  let me = null; // { username, role }

  const TIERS = [
    { key: 'bronze', label: '青铜', icon: '🛡' },
    { key: 'silver', label: '白银', icon: '⚪' },
    { key: 'gold', label: '黄金', icon: '🟡' },
    { key: 'platinum', label: '铂金', icon: '💠' },
    { key: 'diamond', label: '钻石', icon: '💎' },
    { key: 'master', label: '大师', icon: '🔮' },
    { key: 'grandmaster', label: '宗师', icon: '👁' },
    { key: 'king', label: '王者', icon: '👑' },
  ];
  const TIER_MAP = Object.fromEntries(TIERS.map(t => [t.key, t]));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(ms) { return ms ? new Date(ms).toLocaleString('zh-CN') : '-'; }
  function maskOpenid(o) {
    if (!o) return '-';
    return o.length > 6 ? o.slice(0, 2) + '***' + o.slice(-3) : '***';
  }

  // ============ API ============
  // 云函数 HTTP 触发：POST 到 <API_BASE>/adminRouter，body = { action, token, ...params }
  async function callAdmin(action, params) {
    const res = await fetch(API_BASE + '/adminRouter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, ...(params || {}) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) {
      if (json.statusCode === 401) { logout(); throw new Error('登录已过期'); }
      throw new Error(json.error || ('HTTP ' + (json.statusCode || res.status)));
    }
    // 解包：去掉 ok / statusCode，只留业务数据（渲染层直接读 r.rows / r.total 等）
    const { ok, statusCode, ...data } = json;
    return data;
  }

  // 登录（独立云函数 adminLogin）
  async function callLogin(username, password) {
    const res = await fetch(API_BASE + '/adminLogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.error || ('HTTP ' + (json.statusCode || res.status)));
    return json;
  }

  // 本地 REST 模式（保留，开发态/测试态）
  async function apiLocal(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') { logout(); throw new Error('登录已过期'); }
    if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
    return json;
  }

  // 统一入口：把 method+path 映射成 action（云模式）或透传（本地模式）
  async function api(method, path, body) {
    if (!CLOUD_MODE) return apiLocal(method, path, body);

    // 登录特判
    if (path === '/api/admin/login') {
      const r = await callLogin(body.username, body.password);
      return { token: r.token, username: r.username, role: r.role };
    }
    if (path === '/api/admin/me') return callAdmin('me', {});

    // 玩家
    if (path.startsWith('/api/admin/players')) {
      const m = path.match(/^\/api\/admin\/players\/([^/]+)(?:\/ban)?$/);
      if (m) {
        const id = m[1];
        if (path.endsWith('/ban')) return callAdmin('banPlayer', { id, ...body });
        if (method === 'PUT') return callAdmin('updatePlayer', { id, patch: body.patch || body });
        return callAdmin('playerDetail', { id });
      }
      // /api/admin/players?keyword=... → action players
      const q = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));
      return callAdmin('players', q);
    }

    // 统计
    if (path === '/api/admin/stats/overview') return callAdmin('stats', {});

    // 日志
    if (path.startsWith('/api/admin/logs')) {
      const q = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));
      return callAdmin('logs', q);
    }

    // 公告
    if (path.startsWith('/api/admin/announcements')) {
      const m = path.match(/^\/api\/admin\/announcements\/([^/]+)$/);
      if (m) {
        const id = m[1];
        if (method === 'PUT') return callAdmin('updateAnnouncement', { id, patch: body });
        if (method === 'DELETE') return callAdmin('deleteAnnouncement', { id });
        return callAdmin('listAnnouncements', {});
      }
      if (method === 'POST') return callAdmin('createAnnouncement', body);
      // GET 列表：本地 REST 返回裸数组，云函数返回 {rows}，这里解出 rows 保持一致
      const r = await callAdmin('listAnnouncements', {});
      return r.rows || [];
    }

    // 管理员
    if (path.startsWith('/api/admin/users')) {
      const m = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (m) {
        if (method === 'DELETE') return callAdmin('deleteAdmin', { id: m[1] });
      }
      if (method === 'POST') return callAdmin('createAdmin', body);
      // GET 列表：本地 REST 返回裸数组，云函数返回 {rows}，这里解出 rows 保持一致
      const r = await callAdmin('listAdmins', {});
      return r.rows || [];
    }

    throw new Error('未知接口：' + method + ' ' + path);
  }

  // ============ 登录 / 退出 ============
  async function login() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = '登录中…';
    console.log('[TK] login submit', { username, hasPwd: !!password });
    try {
      const r = await api('POST', '/api/admin/login', { username, password });
      console.log('[TK] login ok', r.role);
      token = r.token; me = { username: r.username, role: r.role };
      localStorage.setItem('tk_admin_token', token);
      enter();
    } catch (e) {
      console.warn('[TK] login fail', e);
      errEl.textContent = '登录失败：' + e.message;
      alert('登录失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  }
  function logout() {
    token = null; me = null;
    localStorage.removeItem('tk_admin_token');
    document.getElementById('appView').classList.remove('active');
    document.getElementById('loginView').style.display = 'flex';
  }
  function enter() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('appView').classList.add('active');
    document.getElementById('adminName').textContent = me.username + '（' + me.role + '）';
    const isSuper = me.role === 'superadmin';
    document.getElementById('navAdmins').style.display = isSuper ? 'flex' : 'none';
    switchView('overview');
  }

  // ============ 视图切换 ============
  function switchView(name) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + name));
    if (name === 'overview') loadOverview();
    if (name === 'players') loadPlayers();
    if (name === 'announcements') loadAnnouncements();
    if (name === 'logs') loadLogs();
    if (name === 'admins') loadAdmins();
  }

  // ============ 总览 ============
  async function loadOverview() {
    const s = await api('GET', '/api/admin/stats/overview');
    const grid = document.getElementById('overviewStats');
    grid.innerHTML = [
      stat('总玩家', s.totalPlayers),
      stat('今日活跃', s.dau),
      stat('总对局', s.totalMatches),
      stat('已封禁', s.banned),
      stat('金币总量', s.totalGold),
      stat('钻石总量', s.totalDiamond),
      stat('星尘总量', s.totalStardust),
    ].join('');

    // 段位分布
    const dist = Object.fromEntries((s.tierDist || []).map(d => [d.tier, d.c]));
    const max = Math.max(1, ...Object.values(dist));
    document.getElementById('tierDist').innerHTML = TIERS.map(t => {
      const c = dist[t.key] || 0;
      const pct = Math.round(c / max * 100);
      return `<div class="bar-row"><span class="name">${t.icon} ${t.label}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="count">${c}</span></div>`;
    }).join('');
  }
  function stat(label, value) {
    return `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
  }

  // ============ 玩家管理 ============
  let playersPage = 1;
  async function loadPlayers() {
    const q = new URLSearchParams({
      keyword: document.getElementById('pKeyword').value.trim(),
      tier: document.getElementById('pTier').value,
      status: document.getElementById('pStatus').value,
      minTrophies: document.getElementById('pMinTrophies').value,
      maxTrophies: document.getElementById('pMaxTrophies').value,
      sort: 'trophies', order: 'desc', page: playersPage, pageSize: 50,
    });
    const r = await api('GET', '/api/admin/players?' + q.toString());
    const tbody = document.getElementById('playersTbody');
    tbody.innerHTML = (r.rows || []).map(row => {
      const t = TIER_MAP[row.tier] || { label: row.tier, icon: '❔' };
      const isBanned = row.status === 'banned';
      return `<tr>
        <td>${esc(row.nickname)}</td>
        <td class="mono">${esc(row.uid)}</td>
        <td><span class="tier-badge">${t.icon} ${esc(t.label)}</span></td>
        <td class="num">${row.trophies}</td>
        <td class="num">${row.power}</td>
        <td class="num">${row.gold}</td>
        <td class="num">${row.diamond}</td>
        <td class="num">${row.stardust}</td>
        <td><span class="chip ${isBanned ? 'banned' : 'active'}">${isBanned ? '已封禁' : '正常'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="TK.detail('${esc(row.uid)}')">详情</button>
          ${me.role !== 'readonly' ? `<button class="btn btn-primary btn-sm" onclick="TK.edit('${esc(row.uid)}')">改档</button>
          <button class="btn ${isBanned ? 'btn-ghost' : 'btn-danger'} btn-sm" onclick="TK.ban('${esc(row.uid)}')">${isBanned ? '解封' : '封禁'}</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    document.getElementById('playersTotal').textContent = `共 ${r.total} 人`;
    document.getElementById('pPage').textContent = `第 ${r.page} 页`;
    document.getElementById('pPrev').disabled = r.page <= 1;
    document.getElementById('pNext').disabled = r.page * r.pageSize >= r.total;
  }

  async function detail(uid) {
    const r = await api('GET', '/api/admin/players/' + uid);
    const a = r.account, p = r.profile || {};
    const t = TIER_MAP[a.tier] || { label: a.tier, icon: '❔' };
    const units = p.collectedUnits ? Object.entries(p.collectedUnits).map(([id, u]) => `${esc(id)} Lv.${u.level}（招募 ${u.recruitCount || 0}）`).join('、') : '-';
    const deps = p.deployment ? (p.deployment.units || []).join('、') : '-';
    const html = `
      <div class="section-title">基本信息</div>
      <div class="kv">
        <span class="k">昵称</span><span class="v">${esc(a.nickname)}</span>
        <span class="k">uid</span><span class="v mono">${esc(a.uid)}</span>
        <span class="k">openid</span><span class="v mono">${esc(maskOpenid(a.openid))}</span>
        <span class="k">状态</span><span class="v">${a.status === 'banned' ? '已封禁（' + esc(a.ban_reason || '无原因') + '）' : '正常'}</span>
        <span class="k">创建时间</span><span class="v">${fmtTime(a.created_at)}</span>
        <span class="k">最近登录</span><span class="v">${fmtTime(a.last_login_at)}</span>
      </div>
      <div class="section-title">货币</div>
      <div class="kv">
        <span class="k">金币</span><span class="v">${a.gold}</span>
        <span class="k">钻石</span><span class="v">${a.diamond}</span>
        <span class="k">星尘</span><span class="v">${a.stardust}</span>
      </div>
      <div class="section-title">天梯</div>
      <div class="kv">
        <span class="k">段位</span><span class="v">${t.icon} ${esc(t.label)}</span>
        <span class="k">奖杯</span><span class="v">${a.trophies}（最高 ${p.highestTrophies || 0}）</span>
        <span class="k">战力</span><span class="v">${a.power}</span>
        <span class="k">PvP</span><span class="v">${a.pvp_wins} 胜 / ${p.pvpLosses || 0} 负，连胜 ${p.pvpWinStreak || 0}</span>
        <span class="k">总对局</span><span class="v">${a.total_games}（胜 ${p.totalWins || 0}）</span>
      </div>
      <div class="section-title">养成</div>
      <div class="kv">
        <span class="k">已收集兵种</span><span class="v">${units}</span>
        <span class="k">上阵 6 槽</span><span class="v">${esc(deps)}</span>
        <span class="k">通行证</span><span class="v">Lv.${p.battlePass ? p.battlePass.level : 0}（exp ${p.battlePass ? p.battlePass.exp : 0}）</span>
        <span class="k">新手引导</span><span class="v">${p.tutorialStep === -1 ? '已完成' : '步骤 ' + p.tutorialStep}</span>
      </div>`;
    document.getElementById('detailBody').innerHTML = html;
    openModal('detailModal');
  }

  function edit(uid) {
    api('GET', '/api/admin/players/' + uid).then(r => {
      const p = r.profile || {};
      // 上限与 server/config.js CURRENCY_CAPS 对齐（99999999），HTML max 仅作输入提示；
      // 服务端会用 WHITELIST.max 做最终硬校验。
      const fields = [
        ['nickname', '昵称', p.nickname, 'text', null],
        ['gold', '金币', p.gold, 'number', 99999999],
        ['diamond', '钻石', p.diamond, 'number', 99999999],
        ['stardust', '星尘', p.stardust, 'number', 99999999],
        ['trophies', '奖杯', p.trophies, 'number', 99999],
        ['battlePass.level', '通行证等级', p.battlePass ? p.battlePass.level : 0, 'number', 9999],
        ['battlePass.exp', '通行证经验', p.battlePass ? p.battlePass.exp : 0, 'number', 999999],
      ];
      document.getElementById('editUid').textContent = 'uid: ' + uid;
      document.getElementById('editBody').innerHTML = fields.map(([key, label, val, type, max]) => `
        <div class="field">
          <label>${esc(label)}（当前：${esc(val)}）${max != null ? `<span class="hint" style="margin-left:6px">上限 ${max.toLocaleString('en-US')}</span>` : ''}</label>
          <input data-key="${esc(key)}" data-old="${esc(val)}" type="${type}" value="${esc(val)}"${max != null ? ` max="${max}"` : ''} />
        </div>`).join('') + `<p class="hint">提示：uid / openid / 上阵阵容禁止修改；奖杯改动会自动重算段位。</p>`;
      document.getElementById('editSave').onclick = () => saveEdit(uid);
      openModal('editModal');
    });
  }

  async function saveEdit(uid) {
    const patch = {};
    document.querySelectorAll('#editBody input[data-key]').forEach(inp => {
      const key = inp.dataset.key;
      const old = inp.dataset.old;
      const val = inp.type === 'number' ? Number(inp.value) : inp.value;
      if (String(val) !== String(old)) patch[key] = val;
    });
    if (Object.keys(patch).length === 0) { closeModal('editModal'); return; }
    try {
      const r = await api('PUT', '/api/admin/players/' + uid, { patch });
      closeModal('editModal');
      alert('修改成功，已写操作日志');
      loadPlayers();
    } catch (e) { alert('修改失败：' + e.message); }
  }

  function ban(uid) {
    document.getElementById('banUid').textContent = 'uid: ' + uid;
    document.getElementById('banReason').value = '';
    document.getElementById('banUntil').value = '';
    document.getElementById('banSave').onclick = () => saveBan(uid);
    openModal('banModal');
  }
  async function saveBan(uid) {
    const status = document.getElementById('banStatus').value;
    const reason = document.getElementById('banReason').value.trim();
    const untilRaw = document.getElementById('banUntil').value;
    const until = untilRaw ? new Date(untilRaw).getTime() : null;
    try {
      await api('POST', `/api/admin/players/${uid}/ban`, { status, reason, until });
      closeModal('banModal');
      loadPlayers();
    } catch (e) { alert('操作失败：' + e.message); }
  }

  // ============ 公告 ============
  async function loadAnnouncements() {
    const rows = await api('GET', '/api/admin/announcements');
    document.getElementById('annTbody').innerHTML = rows.map(a => `
      <tr>
        <td>${esc(a.title)}</td>
        <td><span class="chip">${esc(a.type)}</span></td>
        <td>${a.enabled ? '<span class="chip active">启用</span>' : '<span class="chip banned">停用</span>'}</td>
        <td>
          ${me.role === 'superadmin' ? `<button class="btn btn-ghost btn-sm" onclick="TK.annEdit('${esc(a.id)}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="TK.annDel('${esc(a.id)}')">删除</button>` : '-'}
        </td>
      </tr>`).join('');
  }
  function annEdit(id) {
    api('GET', '/api/admin/announcements').then(rows => {
      const a = rows.find(x => x.id === id);
      if (!a) return;
      document.getElementById('annModalTitle').textContent = '编辑公告';
      document.getElementById('annType').value = a.type;
      document.getElementById('annTitle').value = a.title;
      document.getElementById('annContent').value = a.content || '';
      document.getElementById('annEnabled').value = String(a.enabled);
      document.getElementById('annSave').onclick = () => saveAnn(id);
      openModal('annModal');
    });
  }
  function annNew() {
    document.getElementById('annModalTitle').textContent = '新建公告';
    document.getElementById('annTitle').value = '';
    document.getElementById('annContent').value = '';
    document.getElementById('annType').value = 'notice';
    document.getElementById('annEnabled').value = '1';
    document.getElementById('annSave').onclick = () => saveAnn(null);
    openModal('annModal');
  }
  async function saveAnn(id) {
    const payload = {
      type: document.getElementById('annType').value,
      title: document.getElementById('annTitle').value.trim(),
      content: document.getElementById('annContent').value,
      enabled: Number(document.getElementById('annEnabled').value),
    };
    try {
      if (id) await api('PUT', '/api/admin/announcements/' + id, payload);
      else await api('POST', '/api/admin/announcements', payload);
      closeModal('annModal');
      loadAnnouncements();
    } catch (e) { alert('保存失败：' + e.message); }
  }
  async function annDel(id) {
    if (!confirm('确认删除该公告？')) return;
    await api('DELETE', '/api/admin/announcements/' + id);
    loadAnnouncements();
  }

  // ============ 操作日志 ============
  async function loadLogs() {
    const q = new URLSearchParams({
      adminName: document.getElementById('lAdmin').value.trim(),
      action: document.getElementById('lAction').value.trim(),
      pageSize: 100,
    });
    const r = await api('GET', '/api/admin/logs?' + q.toString());
    document.getElementById('logsTbody').innerHTML = (r.rows || []).map(l => {
      let detail = '-';
      if (l.detail) {
        try { detail = JSON.stringify(JSON.parse(l.detail)); } catch { detail = l.detail; }
      }
      return `<tr>
        <td>${fmtTime(l.created_at)}</td>
        <td>${esc(l.admin_name || '系统')}</td>
        <td><span class="chip">${esc(l.action)}</span></td>
        <td class="mono">${esc(l.target || '-')}</td>
        <td class="mono" style="font-size:11px">${esc(detail)}</td>
      </tr>`;
    }).join('');
    document.getElementById('logsTotal').textContent = `共 ${r.total} 条`;
  }

  // ============ 管理员 ============
  async function loadAdmins() {
    const rows = await api('GET', '/api/admin/users');
    document.getElementById('admTbody').innerHTML = rows.map(a => `
      <tr>
        <td>${esc(a.username)}</td>
        <td><span class="chip">${esc(a.role)}</span></td>
        <td>${fmtTime(a.created_at)}</td>
        <td>${a.username !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="TK.admDel('${esc(a.id)}', '${esc(a.username)}')">删除</button>` : '-'}</td>
      </tr>`).join('');
  }
  function admNew() {
    document.getElementById('admUsername').value = '';
    document.getElementById('admPassword').value = '';
    document.getElementById('admRole').value = 'operator';
    document.getElementById('admSave').onclick = saveAdm;
    openModal('admModal');
  }
  async function saveAdm() {
    const username = document.getElementById('admUsername').value.trim();
    const password = document.getElementById('admPassword').value;
    const role = document.getElementById('admRole').value;
    try {
      await api('POST', '/api/admin/users', { username, password, role });
      closeModal('admModal');
      loadAdmins();
    } catch (e) { alert('创建失败：' + e.message); }
  }
  async function admDel(id, name) {
    if (!confirm('确认删除管理员 ' + name + '？')) return;
    await api('DELETE', '/api/admin/users/' + id);
    loadAdmins();
  }

  // ============ 弹窗 ============
  function openModal(id) { document.getElementById(id).classList.add('active'); }
  function closeModal(id) { document.getElementById(id).classList.remove('active'); }

  // ============ 事件绑定 ============
  function bind() {
    const loginBtn = document.getElementById('loginBtn');
    if (!loginBtn) throw new Error('loginBtn not found');
    loginBtn.addEventListener('click', e => { e.preventDefault(); login(); });
    document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });
    document.getElementById('logoutBtn').onclick = logout;
    document.querySelectorAll('.nav-item').forEach(el => el.onclick = () => switchView(el.dataset.view));

    document.getElementById('pSearch').onclick = () => { playersPage = 1; loadPlayers(); };
    document.getElementById('pPrev').onclick = () => { if (playersPage > 1) { playersPage--; loadPlayers(); } };
    document.getElementById('pNext').onclick = () => { playersPage++; loadPlayers(); };
    document.getElementById('pKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') { playersPage = 1; loadPlayers(); } });

    document.getElementById('lSearch').onclick = loadLogs;
    document.getElementById('annNew').onclick = annNew;
    document.getElementById('admNew').onclick = admNew;

    // 关闭弹窗：点遮罩空白处
    document.querySelectorAll('.modal-mask').forEach(m => m.addEventListener('click', e => {
      if (e.target === m) m.classList.remove('active');
    }));
  }

  // 段位下拉初始化
  function initTierSelect() {
    document.getElementById('pTier').innerHTML = '<option value="">全部段位</option>' +
      TIERS.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('');
  }

  // 暴露给 onclick
  window.TK = { detail, edit, ban, annEdit, annNew, annDel, admDel, admNew };
  window.closeModal = closeModal;

  // ============ 启动 ============
  try {
    initTierSelect();
    bind();
  } catch (e) {
    _bootError('init failed: ' + (e && e.message || e));
    return;
  }
  if (token) {
    // 尝试用已有 token 恢复会话
    api('GET', '/api/admin/me')
      .then(r => {
        me = { username: r.username, role: r.role };
        enter();
      })
      .catch(() => { token = null; localStorage.removeItem('tk_admin_token'); });
  }
})();

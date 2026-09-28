/**
 * 占地之王（Territory King）· 本地存档管理脚本
 * =================================================
 * 用途：查看 / 修改玩家账户存档数据（货币、兵种、奖杯、引导、账号等）。
 * 适用环境：浏览器 DevTools Console、微信开发者工具 Console、真机 vConsole。
 *
 * 用法：把整段代码复制粘贴到 Console 回车，之后用 `TK.help()` 查看全部命令。
 *
 * 重要提醒：
 *  1. 本游戏当前是「本地存档」——数据存在玩家设备（localStorage / wx storage），
 *     没有服务器数据库。改完需「刷新页面 / 重新进入游戏」才生效。
 *  2. 改前建议先 `TK.dump()` 备份一份 JSON。
 *  3. 昵称(uid/nickname/openid) 属呈现层+握手层，改动不影响战斗 checksum，可放心改。
 *  4. 上阵(units)必须是 6 个「已收集且不重复」的兵种，否则进入游戏会被自动修复回默认。
 */
(function () {
  'use strict';

  const isWx = typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function';
  const ACCOUNTS = 'territory_king_accounts';
  const LEGACY_PROFILE = 'territory_king_profile';

  // ---- 存储底层（双环境自适应） ----
  const read = (k) => {
    if (isWx) { try { return wx.getStorageSync(k) || null; } catch (e) { return null; } }
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  };
  const write = (k, v) => {
    if (isWx) { try { wx.setStorageSync(k, v); return true; } catch (e) { return false; } }
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  };
  const remove = (k) => {
    if (isWx) { try { wx.removeStorageSync(k); return true; } catch (e) { return false; } }
    try { localStorage.removeItem(k); return true; } catch (e) { return false; }
  };
  const pKey = (id) => 'territory_king_profile_' + id;
  const log = (...a) => console.log('[TK]', ...a);

  // ---- 定位当前账号 / 存档 ----
  const accounts = () => read(ACCOUNTS);
  const currentId = () => { const a = accounts(); return a && a.current ? a.current : null; };
  const currentProfile = () => {
    const id = currentId();
    return id ? read(pKey(id)) : read(LEGACY_PROFILE);
  };
  const saveCurrent = (p) => {
    const id = currentId();
    const k = id ? pKey(id) : LEGACY_PROFILE;
    const ok = write(k, p);
    log(ok ? `已保存到 ${k}` : `保存失败：${k}`);
    return ok;
  };

  const CURRENCY_CAPS = { gold: 99999999, diamond: 99999999, stardust: 99999999 };

  // 段位阈值（与 LadderSystem.TIERS 一致）
  const TIERS = [
    { key: 'bronze',      label: '青铜', min: 0 },
    { key: 'silver',      label: '白银', min: 200 },
    { key: 'gold',        label: '黄金', min: 400 },
    { key: 'platinum',    label: '铂金', min: 700 },
    { key: 'diamond',     label: '钻石', min: 1000 },
    { key: 'master',      label: '大师', min: 1300 },
    { key: 'grandmaster', label: '宗师', min: 1600 },
    { key: 'king',        label: '王者', min: 1900 },
  ];
  const tierOf = (n) => {
    let t = TIERS[0];
    for (const x of TIERS) { if (n >= x.min) t = x; }
    return t;
  };

  const TK = {
    env: isWx ? 'wx' : 'browser',

    help() {
      log('=== 占地之王 存档管理命令 ===');
      log('TK.dump()                    完整导出（账号+当前存档），改前先备份');
      log('TK.listAccounts()            列出所有本地账号');
      log('TK.get("gold")               读字段（支持点路径，如 collectedUnits.swordsman.level）');
      log('TK.set("gold", 99999)        写字段');
      log('TK.addGold(n) / addDiamond(n) / addStardust(n)   加货币（自动上限）');
      log('TK.setTrophies(n)            改奖杯（影响段位）');
      log('TK.setTier("king")           按段位名设奖杯（青铜/白银/黄金/铂金/钻石/大师/宗师/王者）');
      log('TK.listUnits()               列出已收集兵种');
      log('TK.setUnitLevel(id, lv)      改兵种等级');
      log('TK.addUnit(id)               新增兵种（level=1）');
      log('TK.setTutorial(-1)           改引导进度（-1=已完成，0~4=进行中）');
      log('TK.reset()                   重置当前账号存档（删 profile，重进新建）');
      log('TK.clearAll()                清空全部数据（账号+所有存档，危险）');
      log('改完刷新页面 / 重新进游戏才生效。');
    },

    dump() {
      const out = { env: this.env, accounts: accounts(), currentProfile: currentProfile() };
      console.log(JSON.stringify(out, null, 2));
      return out;
    },

    listAccounts() {
      const a = accounts();
      if (!a) { log('无账号数据（首次进入会自动创建 acc_default）'); return null; }
      log('当前账号:', a.current);
      a.list.forEach((x) => console.log(`  - ${x.id}  uid=${x.uid}  nickname=${x.nickname}  createdAt=${x.createdAt}`));
      return a;
    },

    get(path) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return undefined; }
      let v = p;
      for (const k of String(path).split('.')) { if (v == null) return undefined; v = v[k]; }
      return v;
    },

    set(path, value) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return false; }
      const parts = String(path).split('.');
      let o = p;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = value;
      saveCurrent(p);
      return true;
    },

    _addCurrency(type, n) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return false; }
      const cap = CURRENCY_CAPS[type] || Infinity;
      const before = p[type] || 0;
      p[type] = Math.min(before + n, cap);
      log(`${type}: ${before} → ${p[type]} (上限 ${cap})`);
      return saveCurrent(p);
    },
    addGold(n) { return this._addCurrency('gold', n); },
    addDiamond(n) { return this._addCurrency('diamond', n); },
    addStardust(n) { return this._addCurrency('stardust', n); },

    setTrophies(n) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return false; }
      const v = Math.max(0, Math.floor(n));
      p.trophies = v;
      if ((p.highestTrophies || 0) < v) p.highestTrophies = v;
      log(`奖杯 → ${v}（段位：${tierOf(v).label}）`);
      return saveCurrent(p);
    },

    setTier(key) {
      const t = TIERS.find((x) => x.key === key || x.label === key);
      if (!t) { log('未知段位，可用：', TIERS.map((x) => x.key + '=' + x.label).join(', ')); return false; }
      return this.setTrophies(t.min);
    },

    listUnits() {
      const p = currentProfile();
      if (!p || !p.collectedUnits) { log('未找到存档或兵种数据'); return null; }
      const rows = Object.entries(p.collectedUnits).map(([id, u]) => `${id}: Lv.${u.level} 招募进度${u.recruitCount || 0}`);
      rows.forEach((r) => console.log('  - ' + r));
      return p.collectedUnits;
    },

    setUnitLevel(unitId, level) {
      const p = currentProfile();
      if (!p || !p.collectedUnits || !p.collectedUnits[unitId]) {
        log(`兵种不存在：${unitId}（已收集：${p && p.collectedUnits ? Object.keys(p.collectedUnits).join(', ') : '无'}）`);
        return false;
      }
      p.collectedUnits[unitId].level = Math.max(1, Math.floor(level));
      log(`${unitId} 等级 → ${p.collectedUnits[unitId].level}`);
      return saveCurrent(p);
    },

    addUnit(unitId) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return false; }
      if (!p.collectedUnits) p.collectedUnits = {};
      p.collectedUnits[unitId] = { level: 1, recruitCount: 0 };
      log(`新增兵种 ${unitId}（Lv.1）。注意：需在游戏内上阵才会生效，且上阵需 6 个不同兵种。`);
      return saveCurrent(p);
    },

    setTutorial(step) {
      const p = currentProfile();
      if (!p) { log('未找到当前存档'); return false; }
      p.tutorialStep = step;
      log(`tutorialStep → ${step}（-1=已完成，0~4=进行中，null=旧档视为完成）`);
      return saveCurrent(p);
    },

    reset() {
      const id = currentId();
      const k = id ? pKey(id) : LEGACY_PROFILE;
      const ok = remove(k);
      log(ok ? `已删除存档 ${k}（重新进入游戏将新建默认存档）` : '删除失败');
      return ok;
    },

    clearAll() {
      const a = accounts();
      const keys = [ACCOUNTS, LEGACY_PROFILE];
      if (a && Array.isArray(a.list)) a.list.forEach((x) => keys.push(pKey(x.id)));
      keys.forEach(remove);
      log('已清空全部数据：', keys.join(', '));
      return true;
    },
  };

  globalThis.TK = TK;
  log('管理脚本已就绪（环境: ' + TK.env + '）。输入 TK.help() 查看命令。');
})();

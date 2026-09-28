/**
 * AccountManager — 多账号管理器（本地游客账号）
 *
 * 目标：支持「登录 / 切换 / 注销」多个本地账号，允许同一浏览器开两个账号做联机测试。
 *
 * 账号模型升级（取代原「单账号」模型）：
 *   - 每个账号 = 一份绑定数据：{ id, uid, nickname, createdAt }
 *   - 账号列表 + 当前账号指针存 `territory_king_accounts`
 *   - 每个账号的养成存档存 `territory_king_profile_<accountId>`（ProfileManager 动态 key）
 *   - uid 不再独立存 `territory_king_session`，而是账号元数据的一部分 → 解决「uid 与 profile 解耦」隐患
 *
 * 旧数据迁移（向后兼容）：首次升级时若发现旧的单账号数据
 *   `territory_king_profile` / `territory_king_session`，自动迁移为默认账号 `acc_default`，数据不丢。
 *
 * 关键约束：uid / nickname 属「呈现层 + 握手层」数据，绝不进入帧同步世界状态 / 命令 / checksum。
 *
 * 依赖方向：ProfileManager / SessionManager → AccountManager（单向，AccountManager 不依赖它们，避免循环）。
 */

const ACCOUNTS_KEY = 'territory_king_accounts';
const LEGACY_PROFILE_KEY = 'territory_king_profile';
const LEGACY_SESSION_KEY = 'territory_king_session';

export class AccountManager {
  static _store = null;   // 账号列表存储 { current, list }（init 后缓存）
  static _current = null; // 当前账号对象 { id, uid, nickname, createdAt }

  /** 判断是否为微信环境（wx.setStorageSync 可用） */
  static isWxEnv() {
    return typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function';
  }

  /** 通用读（wx 对象 / localStorage JSON 字符串），返回对象或 null */
  static _read(key) {
    if (AccountManager.isWxEnv()) {
      try { return wx.getStorageSync(key) || null; } catch (e) { return null; }
    }
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /** 通用写（wx 存对象 / localStorage 存 JSON 字符串） */
  static _write(key, data) {
    if (AccountManager.isWxEnv()) {
      try { wx.setStorageSync(key, data); } catch (e) {}
    } else {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
    }
  }

  /** 通用删 */
  static _remove(key) {
    if (AccountManager.isWxEnv()) {
      try { wx.removeStorageSync(key); } catch (e) {}
    } else {
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (e) {}
    }
  }

  /** 账号 id 生成 */
  static _generateId() {
    return 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** uid 生成（与旧 SessionManager.generateUID 同格式） */
  static _generateUID() {
    return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  /** 默认昵称（与 PlayerProfile.generateDefaultNickname 同格式，避免 import 造成循环依赖） */
  static _defaultNickname() {
    const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return '领主_' + suffix;
  }

  /** 某账号的 profile 存储 key（ProfileManager 动态 key 用） */
  static _profileKey(accountId) {
    return `territory_king_profile_${accountId}`;
  }

  /**
   * 初始化：加载账号列表；若无（首次升级 / 全新环境）则迁移旧单账号数据建立默认账号。
   * 幂等：多次调用不重复迁移（迁移后 ACCOUNTS_KEY 已存在）。
   * @returns {object} 当前账号 { id, uid, nickname, createdAt }
   */
  static init() {
    let store = AccountManager._read(ACCOUNTS_KEY);
    if (!store || !Array.isArray(store.list) || store.list.length === 0) {
      store = AccountManager._migrateLegacy();
    }
    AccountManager._store = store;
    AccountManager._current = store.list.find(a => a.id === store.current) || store.list[0];
    if (AccountManager._current && store.current !== AccountManager._current.id) {
      store.current = AccountManager._current.id;
      AccountManager._write(ACCOUNTS_KEY, store);
    }
    return AccountManager._current;
  }

  /** 迁移旧单账号数据（或全新环境建立默认账号） */
  static _migrateLegacy() {
    const legacyProfile = AccountManager._read(LEGACY_PROFILE_KEY);
    const legacySession = AccountManager._read(LEGACY_SESSION_KEY);
    const uid = (legacySession && legacySession.uid) ? legacySession.uid : AccountManager._generateUID();
    const nickname = (legacyProfile && typeof legacyProfile.nickname === 'string' && legacyProfile.nickname)
      ? legacyProfile.nickname
      : AccountManager._defaultNickname();
    const acc = { id: 'acc_default', uid, nickname, createdAt: Date.now() };
    const list = [acc];

    // 旧 profile 迁移到账号命名空间 key（数据不丢），并清理旧 key
    if (legacyProfile) {
      AccountManager._write(AccountManager._profileKey(acc.id), legacyProfile);
      AccountManager._remove(LEGACY_PROFILE_KEY);
    }
    if (legacySession) AccountManager._remove(LEGACY_SESSION_KEY);

    const store = { current: acc.id, list };
    AccountManager._write(ACCOUNTS_KEY, store);
    return store;
  }

  /** 确保已初始化（login/switchTo/logout 前调用） */
  static _ensureInited() {
    if (!AccountManager._store) AccountManager.init();
  }

  /** 当前账号 id（未初始化返回 null → ProfileManager/SessionManager 走旧固定 key 向后兼容） */
  static getCurrentId() {
    return AccountManager._current ? AccountManager._current.id : null;
  }

  /** 当前账号对象 */
  static getCurrent() {
    return AccountManager._current;
  }

  /** 当前 uid（兼容 SessionManager.getUID 语义） */
  static getUID() {
    return AccountManager._current ? AccountManager._current.uid : null;
  }

  /**
   * 绑定云端权威身份到当前本地账号。
   *
   * 背景：微信真机上 openid 唯一，云端只有 1 份存档（accountId = acc_+openid）。
   * 本地多账号切来切去都指向同一 openid，uid/nickname 应以云端为准，避免来回覆盖。
   * 这里把云端返回的 accountId 作为稳定 uid（accountId 全局唯一且与 openid 一一对应），
   * 让大厅「账号尾号」与后台「uid 列」展示一致。
   *
   * @param {object} identity 云端 login 返回 { accountId, uid, nickname }
   * @returns {object} 更新后的当前账号
   */
  static bindCloudIdentity(identity) {
    AccountManager._ensureInited();
    if (!AccountManager._current || !identity) return AccountManager._current;
    // accountId 是云端唯一主键，用它作为本地稳定 uid（尾号 = openid 尾号，跨本地账号一致）
    const cloudUid = identity.accountId || identity.uid;
    let changed = false;
    if (cloudUid && AccountManager._current.uid !== cloudUid) {
      AccountManager._current.uid = cloudUid;
      changed = true;
    }
    if (identity.nickname && AccountManager._current.nickname !== identity.nickname) {
      AccountManager._current.nickname = identity.nickname;
      changed = true;
    }
    if (changed) {
      // 同步回账号列表缓存 + 落盘
      const item = AccountManager._store.list.find(a => a.id === AccountManager._current.id);
      if (item) { item.uid = AccountManager._current.uid; item.nickname = AccountManager._current.nickname; }
      AccountManager._write(ACCOUNTS_KEY, AccountManager._store);
    }
    return AccountManager._current;
  }

  /** 账号列表（副本，供 UI） */
  static list() {
    return AccountManager._store ? AccountManager._store.list.slice() : [];
  }

  /**
   * 登录（新建账号并切换过去）
   * @param {string} [nickname] 可选昵称；不传则生成默认游客名
   * @returns {object} 新账号 { id, uid, nickname, createdAt }
   */
  static login(nickname = null) {
    AccountManager._ensureInited();
    const acc = {
      id: AccountManager._generateId(),
      uid: AccountManager._generateUID(),
      nickname: (nickname && typeof nickname === 'string' && nickname.trim())
        ? nickname.trim()
        : AccountManager._defaultNickname(),
      createdAt: Date.now(),
    };
    AccountManager._store.list.push(acc);
    AccountManager._store.current = acc.id;
    AccountManager._current = acc;
    AccountManager._write(ACCOUNTS_KEY, AccountManager._store);
    return acc;
  }

  /**
   * 切换到指定账号
   * @param {string} accountId
   * @returns {object|null} 切换后的账号，失败（不存在）返回 null
   */
  static switchTo(accountId) {
    AccountManager._ensureInited();
    const acc = AccountManager._store.list.find(a => a.id === accountId);
    if (!acc) return null;
    AccountManager._store.current = acc.id;
    AccountManager._current = acc;
    AccountManager._write(ACCOUNTS_KEY, AccountManager._store);
    return acc;
  }

  /**
   * 注销账号：删除其 profile 数据 + 从列表移除。
   * 若注销的是当前账号 → 自动切到剩余第一个（无剩余则新建游客兜底）。
   * @param {string} [accountId] 默认当前账号
   * @returns {object|null} 被注销的账号；不存在返回 null
   */
  static logout(accountId = null) {
    AccountManager._ensureInited();
    const store = AccountManager._store;
    const targetId = accountId || store.current;
    const idx = store.list.findIndex(a => a.id === targetId);
    if (idx < 0) return null;
    const [removed] = store.list.splice(idx, 1);

    // 删除该账号的养成存档
    AccountManager._remove(AccountManager._profileKey(removed.id));

    // 注销的是当前账号 → 切换
    if (store.current === removed.id) {
      if (store.list.length > 0) {
        store.current = store.list[0].id;
        AccountManager._current = store.list[0];
      } else {
        // 无剩余账号：新建游客兜底（保证始终有一个可用账号）
        const fresh = {
          id: AccountManager._generateId(),
          uid: AccountManager._generateUID(),
          nickname: AccountManager._defaultNickname(),
          createdAt: Date.now(),
        };
        store.list.push(fresh);
        store.current = fresh.id;
        AccountManager._current = fresh;
      }
    }

    AccountManager._write(ACCOUNTS_KEY, store);
    return removed;
  }
}

export default AccountManager;

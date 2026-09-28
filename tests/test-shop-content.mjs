/**
 * 商店内容更新测试
 * 验证：
 *  1. 商店商品中不再出现将领/装备等已移除系统的内容
 *  2. 分类与商品结构完整（P37：免费/星尘兑换/训练物资/钻石充值/特惠）
 *  3. 新商品购买链路正常（扣费/发放/限购）
 */
const noop = () => {};
global.document = {
  getElementById: () => null,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => ({ getContext: () => null, style: {} }),
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;

const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + String(path).replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const ShopSystem = (await import('../src/meta/ShopSystem.js')).default;

console.log('=== 测试1: 商店内容不含已移除系统(将领/装备/碎片/券) ===');
{
  const items = ShopSystem.getShopItems();
  const all = [];
  for (const cat of items) {
    for (const it of cat.items) {
      all.push({ cat: cat.categoryName, id: it.id, name: it.name, desc: it.desc || '' });
    }
  }
  assert(all.length > 0, `商品列表非空(${all.length}件)`);
  const bad = all.filter(x =>
    /将领|装备|碎片|hero|equip|shard|ticket/i.test(`${x.id} ${x.name} ${x.desc}`)
  );
  assert(bad.length === 0, bad.length === 0 ? '无将领/装备/碎片/券残留' : `残留: ${bad.map(b => b.name).join(', ')}`);
}

console.log('=== 测试2: 分类结构完整 ===');
{
  const items = ShopSystem.getShopItems();
  const names = items.map(c => c.categoryName);
  // P25 features.shopDiamondTab=false 默认：钻石充值分类已被过滤
  // P37：新增「免费」分页且排第一（商店默认分页）；货币兑换 → 星尘兑换
  assert(names.join(',') === '免费,星尘兑换,训练物资,特惠', `分类=${names.join(',')}（不含钻石充值）`);
  assert(items[0].categoryId === 'free', '免费分页为第 1 个分页（默认展示）');

  const currency = items.find(c => c.categoryId === 'currency');
  assert(currency.items.some(i => i.id === 'exchange_stardust'), '星尘兑换含金币→星尘兑换');

  const packs = items.find(c => c.categoryId === 'packs');
  const packIds = packs.items.map(i => i.id).sort().join(',');
  assert(packIds === 'train_pack_l,train_pack_m,train_pack_s', `训练物资=${packIds}`);
  for (const p of packs.items) {
    assert(p.reward.gold > 0 && p.reward.stardust > 0, `${p.name} 奖励含金币+星尘`);
  }

  const special = items.find(c => c.categoryId === 'special');
  assert(special.items.some(i => i.id === 'weekly_pack'), '特惠含周特惠包');
  // P26 联动：默认 battlePass=false → special 不含 battle_pass_premium
  assert(!special.items.some(i => i.id === 'battle_pass_premium'),
    'battlePass=false 默认：特惠不含通行证(高级)（联动隐藏）');
}

console.log('=== 测试3: 训练物资包购买链路 ===');
{
  const profile = ProfileManager.get();
  profile.gold = 0;
  profile.stardust = 0;
  profile.diamond = 1000;
  delete profile.shopPurchases;
  ProfileManager.save();

  const r = ShopSystem.purchase('train_pack_m');
  assert(r.success, '购买训练物资(中)成功');
  assert(profile.diamond === 1000 - 280, `钻石扣除 ${profile.diamond} = 720`);
  assert(profile.gold === 8000, `金币发放 ${profile.gold} = 8000`);
  assert(profile.stardust === 100, `星尘发放 ${profile.stardust} = 100`);
  assert((profile.shopPurchases.train_pack_m || 0) === 1, '购买记录+1');

  const items = ShopSystem.getShopItems();
  const packs = items.find(c => c.categoryId === 'packs');
  const m = packs.items.find(i => i.id === 'train_pack_m');
  assert(m.remaining === 4, `限购剩余 ${m.remaining} = 4`);
}

console.log('=== 测试4: 金币兑换星尘 ===');
{
  const profile = ProfileManager.get();
  profile.gold = 5000;
  profile.stardust = 0;
  ProfileManager.save();

  const r = ShopSystem.purchase('exchange_stardust');
  assert(r.success, '金币兑换星尘成功');
  assert(profile.gold === 5000 - 3000, `金币扣除 ${profile.gold} = 2000`);
  assert(profile.stardust === 50, `星尘发放 ${profile.stardust} = 50`);

  profile.gold = 100;
  ProfileManager.save();
  const r2 = ShopSystem.purchase('exchange_stardust');
  assert(!r2.success && r2.reason === '货币不足', '金币不足时拒绝购买');
}

console.log('=== 测试5: 限购与通行证（默认 battlePass=false 联动拦截） ===');
{
  const profile = ProfileManager.get();
  profile.diamond = 2000;
  profile.battlePass.premium = false;
  delete profile.shopPurchases;
  ProfileManager.save();

  const r1 = ShopSystem.purchase('weekly_pack');
  assert(r1.success, '周特惠包首购成功');
  const r2 = ShopSystem.purchase('weekly_pack');
  assert(!r2.success && r2.reason === '已达购买上限', '周特惠包限购1次');

  // P26 联动：默认 battlePass=false → 购买被防御层拦截 + 商品不在 getShopItems 内
  const rbBlocked = ShopSystem.purchase('battle_pass_premium');
  assert(!rbBlocked.success && /通行证/.test(rbBlocked.reason || ''), `battlePass=false 时购买被拦截：${rbBlocked.reason}`);
  const items = ShopSystem.getShopItems();
  const special = items.find(c => c.categoryId === 'special');
  assert(special && special.items.some(i => i.id === 'weekly_pack'), 'special 分类保留 weekly_pack');
  assert(special && !special.items.some(i => i.id === 'battle_pass_premium'), 'special 分类中 battle_pass_premium 已被过滤');
}

console.log('=== 测试5b: 临时开启 battlePass=true → 通行证高级版可购买 ===');
{
  // P26 联动展开路径：临时开 battlePass=true 验证可购买链路
  const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
  const _cfg = ConfigLoader.get('game');
  const _orig = _cfg.features?.battlePass;
  _cfg.features = { ..._cfg.features, battlePass: true };

  const profile = ProfileManager.get();
  profile.diamond = 2000;
  profile.battlePass.premium = false;
  delete profile.shopPurchases;
  ProfileManager.save();

  const items = ShopSystem.getShopItems();
  const special = items.find(c => c.categoryId === 'special');
  assert(special && special.items.some(i => i.id === 'battle_pass_premium'), 'battlePass=true 时 battle_pass_premium 出现在 special 分类');

  const rb = ShopSystem.purchase('battle_pass_premium');
  assert(rb.success, 'battlePass=true 时购买通行证成功');
  assert(profile.battlePass.premium === true, '通行证高级轨道已解锁');

  // 恢复 battlePass=false 默认
  _cfg.features = { ..._cfg.features, battlePass: _orig };
}

console.log('=== 测试6: ShopSystem 不再依赖 EquipmentSystem ===');
{
  const src = rf(new URL('../src/meta/ShopSystem.js', import.meta.url), 'utf-8');
  assert(!src.includes('EquipmentSystem'), 'ShopSystem 无 EquipmentSystem 导入');
  assert(!src.includes('heroShards'), 'ShopSystem 无 heroShards 分支');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

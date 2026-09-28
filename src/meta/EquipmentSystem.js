/**
 * EquipmentSystem — 装备系统
 * 装备生成(随机品质/词条) / 穿戴卸下 / 加成计算 / 分解
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile } from './ProfileManager.js';

let _equipIdCounter = 0;

/**
 * 生成唯一装备实例ID
 */
function _genEquipUid() {
  _equipIdCounter++;
  return `eq_${Date.now()}_${_equipIdCounter}`;
}

/**
 * 获取配置
 */
function _getConfig() {
  return ConfigLoader.get('equipment');
}

/**
 * 根据权重随机选择品质
 */
function _rollQuality(weights) {
  const config = _getConfig();
  const qualityWeights = weights || {};
  // 用配置中的默认权重
  for (const q of config.qualities) {
    if (!qualityWeights[q.id]) qualityWeights[q.id] = q.weight;
  }
  const total = Object.values(qualityWeights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const q of config.qualities) {
    roll -= (qualityWeights[q.id] || 0);
    if (roll <= 0) return q;
  }
  return config.qualities[0];
}

/**
 * 随机选择属性类型（按槽位过滤）
 */
function _rollStatType(slot, excludeTypes = []) {
  const config = _getConfig();
  const available = config.statTypes.filter(s =>
    s.appliesTo.includes(slot) && !excludeTypes.includes(s.id)
  );
  if (available.length === 0) return config.statTypes[0];
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * 生成随机属性值
 */
function _rollStatValue(statType) {
  const min = statType.minValue;
  const max = statType.maxValue;
  return Math.round((min + Math.random() * (max - min)) * 1000) / 1000;
}

/**
 * 生成一件随机装备
 * @param {string} slot - 槽位(可选，随机则随机选)
 * @param {string} qualityId - 品质(可选，随机则按权重)
 * @param {object} qualityWeights - 品质权重覆盖
 * @returns {object} 装备实例
 */
function generateEquipment(slot, qualityId, qualityWeights) {
  const config = _getConfig();

  // 槽位
  if (!slot) {
    slot = config.slots[Math.floor(Math.random() * config.slots.length)];
  }

  // 品质
  let quality;
  if (qualityId) {
    quality = config.qualities.find(q => q.id === qualityId) || config.qualities[0];
  } else {
    quality = _rollQuality(qualityWeights);
  }

  // 主属性
  const mainStatType = _rollStatType(slot);
  const mainStatValue = Math.round(
    (quality.mainStatRange[0] + Math.random() * (quality.mainStatRange[1] - quality.mainStatRange[0])) * 1000
  ) / 1000;

  // 副属性
  const subStats = [];
  const usedTypes = [mainStatType.id];
  for (let i = 0; i < quality.subStatCount; i++) {
    const statType = _rollStatType(slot, usedTypes);
    if (!statType) break;
    subStats.push({
      type: statType.id,
      value: _rollStatValue(statType),
    });
    usedTypes.push(statType.id);
  }

  return {
    uid: _genEquipUid(),
    slot,
    quality: quality.id,
    qualityName: quality.name,
    color: quality.color,
    mainStat: { type: mainStatType.id, value: mainStatValue },
    subStats,
  };
}

/**
 * 关卡完成时掉落装备
 * @param {number} stars - 获得星数
 * @param {boolean} isBossLevel - 是否Boss关
 * @returns {object|null} 掉落的装备，或null
 */
function rollBattleDrop(isWin) {
  const config = _getConfig();
  // 胜利使用bossLevel掉落表（更高概率），失败使用levelComplete掉落表
  const table = isWin ? config.dropTable.bossLevel : config.dropTable.levelComplete;

  const dropRate = isWin ? table.baseDropRate : table.baseDropRate * 0.3;
  if (Math.random() > dropRate) return null;

  return generateEquipment(null, null, table.qualityWeights);
}

/**
 * 获取装备名称
 */
function getEquipmentName(equip) {
  const config = _getConfig();
  const slotName = config.slotNames[equip.slot] || equip.slot;
  const qualityPrefix = equip.qualityName || '';
  return `${qualityPrefix}${slotName}`;
}

/**
 * 穿戴装备
 * @param {string} heroId - 将领ID
 * @param {string} equipUid - 装备UID
 * @returns {boolean} 是否成功
 */
function equip(heroId, equipUid) {
  const profile = getProfile();
  if (!profile.heroEquips) profile.heroEquips = {};
  const config = _getConfig();

  // 查找装备
  const equipIndex = profile.equipments.findIndex(e => e.uid === equipUid);
  if (equipIndex < 0) return false;

  const equipData = profile.equipments[equipIndex];
  const slot = equipData.slot;

  // 确保将领装备槽存在
  if (!profile.heroEquips[heroId]) {
    profile.heroEquips[heroId] = { weapon: null, armor: null, accessory: null, medal: null };
  }

  // 如果该槽位已有装备，先卸下
  const oldEquipUid = profile.heroEquips[heroId][slot];
  if (oldEquipUid) {
    // 旧装备已在equipments列表中，无需移动
  }

  // 穿戴新装备
  profile.heroEquips[heroId][slot] = equipUid;

  return true;
}

/**
 * 卸下装备
 * @param {string} heroId - 将领ID
 * @param {string} slot - 槽位
 * @returns {boolean}
 */
function unequip(heroId, slot) {
  const profile = getProfile();
  if (!profile.heroEquips || !profile.heroEquips[heroId]) return false;
  profile.heroEquips[heroId][slot] = null;
  return true;
}

/**
 * 分解装备
 * @param {string} equipUid - 装备UID
 * @returns {object} 分解获得的资源
 */
function decompose(equipUid) {
  const profile = getProfile();
  const config = _getConfig();

  const equipIndex = profile.equipments.findIndex(e => e.uid === equipUid);
  if (equipIndex < 0) return null;

  const equipData = profile.equipments[equipIndex];

  // 从将领身上卸下
  if (profile.heroEquips) {
    for (const heroId of Object.keys(profile.heroEquips)) {
      for (const slot of Object.keys(profile.heroEquips[heroId])) {
        if (profile.heroEquips[heroId][slot] === equipUid) {
          profile.heroEquips[heroId][slot] = null;
        }
      }
    }
  }

  // 从背包移除
  profile.equipments.splice(equipIndex, 1);

  // 返还资源
  const reward = config.decompose[equipData.quality] || config.decompose.common;
  profile.addCurrency('stardust', reward.stardust);
  profile.addCurrency('gold', reward.gold);

  return reward;
}

/**
 * 添加装备到背包
 */
function addEquipment(equipData) {
  const profile = getProfile();
  if (!equipData.uid) {
    equipData.uid = _genEquipUid();
  }
  profile.equipments.push(equipData);
  return equipData;
}

/**
 * 获取将领当前穿戴的装备列表
 * @param {string} heroId
 * @returns {object[]} 装备实例数组
 */
function getHeroEquipments(heroId) {
  const profile = getProfile();
  const config = _getConfig();
  const result = [];

  if (!profile.heroEquips || !profile.heroEquips[heroId]) return result;

  for (const slot of config.slots) {
    const uid = profile.heroEquips[heroId][slot];
    if (uid) {
      const equip = profile.equipments.find(e => e.uid === uid);
      if (equip) result.push(equip);
    }
  }
  return result;
}

/**
 * 获取所有上阵将领的装备加成
 * @param {PlayerProfile} profile
 * @returns {object} 加成字典 { statType: totalValue }
 */
function getEquippedBonuses(profile) {
  // 将领系统已移除，装备系统暂无装备对象，返回空加成
  return {};
}

/**
 * 获取装备的加成文本描述
 */
function getStatDescription(statType, value) {
  const config = _getConfig();
  const stat = config.statTypes.find(s => s.id === statType);
  const name = stat ? stat.name : statType;
  const percent = Math.round(value * 100);
  return `${name}+${percent}%`;
}

export {
  generateEquipment,
  rollBattleDrop,
  getEquipmentName,
  equip,
  unequip,
  decompose,
  addEquipment,
  getHeroEquipments,
  getEquippedBonuses,
  getStatDescription,
};
export default {
  generateEquipment,
  rollBattleDrop,
  getEquipmentName,
  equip,
  unequip,
  decompose,
  addEquipment,
  getHeroEquipments,
  getEquippedBonuses,
  getStatDescription,
};

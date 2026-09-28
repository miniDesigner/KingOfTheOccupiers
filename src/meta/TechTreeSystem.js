/**
 * TechTreeSystem — 科技树系统
 * 节点升级、前置检查、获取加成
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile, save as saveProfile } from './ProfileManager.js';

/**
 * 获取科技树配置
 */
function getTechTreeConfig() {
  return ConfigLoader.get('techTree');
}

/**
 * 获取所有分支
 */
function getBranches() {
  return getTechTreeConfig().branches;
}

/**
 * 获取节点配置
 */
function getNodeConfig(nodeId) {
  const config = getTechTreeConfig();
  for (const branch of Object.values(config.branches)) {
    const node = branch.nodes.find(n => n.id === nodeId);
    if (node) return node;
  }
  return null;
}

/**
 * 获取节点当前等级
 */
function getNodeLevel(nodeId) {
  return getProfile().getTechNodeLevel(nodeId);
}

/**
 * 检查前置条件是否满足
 */
function canUpgrade(nodeId) {
  const profile = getProfile();
  const node = getNodeConfig(nodeId);
  if (!node) return { ok: false, reason: '节点不存在' };

  const currentLevel = profile.getTechNodeLevel(nodeId);
  if (currentLevel >= node.maxLevel) {
    return { ok: false, reason: '已满级' };
  }

  // 检查前置
  if (node.prerequisite) {
    const prereqLevel = profile.getTechNodeLevel(node.prerequisite.node);
    if (prereqLevel < node.prerequisite.level) {
      const prereqNode = getNodeConfig(node.prerequisite.node);
      return {
        ok: false,
        reason: `需要${prereqNode?.name || node.prerequisite.node}达到${node.prerequisite.level}级`
      };
    }
  }

  // 检查星尘
  const cost = node.costPerLevel[currentLevel];
  if (profile.stardust < cost) {
    return { ok: false, reason: `星尘不足(需要${cost})` };
  }

  return { ok: true };
}

/**
 * 升级节点
 * @returns {object} { success: boolean, reason?: string }
 */
function upgradeNode(nodeId) {
  const check = canUpgrade(nodeId);
  if (!check.ok) return { success: false, reason: check.reason };

  const profile = getProfile();
  const node = getNodeConfig(nodeId);
  const currentLevel = profile.getTechNodeLevel(nodeId);
  const cost = node.costPerLevel[currentLevel];

  profile.spendCurrency('stardust', cost);
  profile.techTree[nodeId] = currentLevel + 1;
  saveProfile();

  return { success: true, newLevel: currentLevel + 1 };
}

/**
 * 获取分支所有节点信息（含当前等级和状态）
 */
function getBranchNodes(branchKey) {
  const config = getTechTreeConfig();
  const branch = config.branches[branchKey];
  if (!branch) return [];

  const profile = getProfile();
  return branch.nodes.map(node => {
    const level = profile.getTechNodeLevel(node.id);
    const check = canUpgrade(node.id);
    return {
      ...node,
      currentLevel: level,
      isMaxLevel: level >= node.maxLevel,
      canUpgrade: check.ok,
      upgradeReason: check.reason,
      nextCost: level < node.maxLevel ? node.costPerLevel[level] : 0,
      isLocked: node.prerequisite && profile.getTechNodeLevel(node.prerequisite.node) < node.prerequisite.level,
    };
  });
}

/**
 * 获取所有分支的节点信息
 */
function getAllBranchNodes() {
  const branches = getBranches();
  const result = {};
  for (const [key, branch] of Object.entries(branches)) {
    result[key] = {
      ...branch,
      nodes: getBranchNodes(key),
    };
  }
  return result;
}

/**
 * 获取已升级节点总数
 */
function getUpgradedNodeCount() {
  const profile = getProfile();
  return Object.keys(profile.techTree).filter(id => profile.techTree[id] > 0).length;
}

/**
 * 获取科技总等级
 */
function getTotalTechLevel() {
  const profile = getProfile();
  return Object.values(profile.techTree).reduce((a, b) => a + b, 0);
}

/**
 * 统计当前可升级科技节点数量（大厅「科技」按钮角标）
 * 口径与 canUpgrade 一致：未满级 + 前置满足 + 星尘足够
 */
function getUpgradeableNodeCount() {
  const branches = getBranches();
  let count = 0;
  for (const branch of Object.values(branches)) {
    for (const node of branch.nodes) {
      if (canUpgrade(node.id).ok) count++;
    }
  }
  return count;
}

export {
  getTechTreeConfig, getBranches, getNodeConfig, getNodeLevel,
  canUpgrade, upgradeNode, getBranchNodes, getAllBranchNodes,
  getUpgradedNodeCount, getTotalTechLevel, getUpgradeableNodeCount,
};
export default {
  getTechTreeConfig, getBranches, getNodeConfig, getNodeLevel,
  canUpgrade, upgradeNode, getBranchNodes, getAllBranchNodes,
  getUpgradedNodeCount, getTotalTechLevel, getUpgradeableNodeCount,
};

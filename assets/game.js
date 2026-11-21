/**
 * 美术资源分包入口（占位文件）
 *
 * assets/ 目录在 game.json 中配置为微信小游戏分包（subpackages.root = "assets/"），
 * 微信规则要求每个「目录型分包」的根下必须存在 game.js 作为入口，否则报
 * "未找到 subpackages[0].root 对应的 /assets/game.js 文件"。
 *
 * 本分包只含美术资源，无需执行任何业务逻辑——下载由主包 game.js 中的
 * wx.loadSubpackage({ name: 'art' }) 驱动，加载完成后资源即可按原路径
 * assets/... 访问。此文件保持为空，避免与主包入口逻辑冲突。
 */

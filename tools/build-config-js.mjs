/**
 * 编译脚本: 把 config/*.json 转换为 config/*.js（CommonJS 模块导出）
 *
 * 原因: 微信小游戏的 require() 不支持 .json 文件（IDE 模块解析器自动追加 .js 后缀），
 *      wx.getFileSystemManager().readFileSync() 在沙箱中报 permission denied 无法读取包内 JSON。
 *
 * 解决方案: 把 JSON 内容嵌入 .js 文件 module.exports，require 即可加载。
 *   - 浏览器预览仍 fetch 原 config/*.json（保留两套）
 *   - 微信小游戏走 require('../../config/<name>.js')
 *
 * 用法: node tools/build-config-js.mjs [--watch]
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CONFIG_DIR = join(PROJECT_ROOT, 'config');

/**
 * 把单个 JSON 文件转成 JS 模块
 */
function convertJsonToJs(jsonFilePath) {
  const content = readFileSync(jsonFilePath, 'utf-8');
  // 验证 JSON 合法
  const data = JSON.parse(content);

  // 输出文件名: example.json → example.js
  const baseName = jsonFilePath.replace(/\.json$/, '');
  const jsFilePath = `${baseName}.js`;

  const jsContent = `/**
 * Auto-generated from ${jsonFilePath.split(/[\\/]/).pop()}
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/${jsonFilePath.split(/[\\/]/).pop().replace('.json', '.js')}') 即可加载
 */
module.exports = ${JSON.stringify(data, null, 2)};
`;

  writeFileSync(jsFilePath, jsContent, 'utf-8');
  return jsFilePath;
}

/**
 * 主流程
 */
function build() {
  console.log(`[build-config-js] Reading from: ${CONFIG_DIR}`);

  const files = readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`[build-config-js] ERROR: No JSON files found in ${CONFIG_DIR}`);
    process.exit(1);
  }

  let ok = 0;
  let totalBytes = 0;
  for (const file of files) {
    const jsonPath = join(CONFIG_DIR, file);
    const stat = statSync(jsonPath);
    totalBytes += stat.size;
    const jsPath = convertJsonToJs(jsonPath);
    console.log(`  [OK] ${file} → ${jsPath.split(/[\\/]/).pop()} (${stat.size}B → ${stat.size + 16}B)`);
    ok++;
  }

  console.log(`[build-config-js] Done: ${ok}/${files.length} files, source total ${totalBytes}B`);
}

build();

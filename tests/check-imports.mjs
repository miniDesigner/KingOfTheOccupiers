// 全模块 import/export 交叉校验（node --check 不会解析模块导入，浏览器静态导入失败会导致页面卡在加载中）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'src'));

function getExports(src) {
  const names = new Set();
  let m;
  const re1 = /export\s*\{([^}]*)\}/g;
  while ((m = re1.exec(src))) {
    for (let part of m[1].split(',')) {
      part = part.trim();
      if (!part) continue;
      const as = part.match(/^[\w$]+(?:\s+as\s+([\w$]+))?$/);
      if (as) names.add(as[1] || part);
    }
  }
  const re2 = /export\s+(?:const|let|var|function\*?|class)\s+([\w$]+)/g;
  while ((m = re2.exec(src))) names.add(m[1]);
  if (/export\s+default/.test(src)) names.add('default');
  if (/export\s*\*/.test(src)) names.add('*');
  return names;
}

let issues = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf-8');
  const re = /import\s*(?:([\w$]+)\s*,?)?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(f), m[3]);
    if (!fs.existsSync(target)) {
      console.log('MISSING FILE:', path.relative(ROOT, f), '->', m[3]);
      issues++;
      continue;
    }
    const exports = getExports(fs.readFileSync(target, 'utf-8'));
    if (m[2]) {
      for (let part of m[2].split(',')) {
        part = part.trim();
        if (!part) continue;
        const name = part.includes(' as ') ? part.split(' as ')[0].trim() : part;
        if (!exports.has(name) && !exports.has('*')) {
          console.log('BAD NAMED IMPORT:', path.relative(ROOT, f), 'imports { ' + name + ' } from', m[3], '— 目标导出:', [...exports].join(', ').slice(0, 100));
          issues++;
        }
      }
    }
    if (m[1] && !exports.has('default') && !exports.has('*')) {
      console.log('BAD DEFAULT IMPORT:', path.relative(ROOT, f), 'imports default from', m[3]);
      issues++;
    }
  }
}
console.log(issues === 0 ? `ALL IMPORTS VALID ✅ (${files.length} files)` : `${issues} issue(s) found`);
process.exit(issues === 0 ? 0 : 1);

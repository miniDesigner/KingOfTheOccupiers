#!/usr/bin/env bash
# cloudfunctions/deploy.sh — 一键部署所有云函数
#
# 用法（在 territory-king-developer/ 根目录下）：
#   bash cloudfunctions/deploy.sh [函数名]
#     - 不带参数：部署全部 6 个函数
#     - 带参数：只部署指定函数（如 bash cloudfunctions/deploy.sh settle）
#
# 关键：先复制 shared/ 到各函数目录（腾讯云函数只打包自身目录），再 tcb fn deploy。
# 依赖：@cloudbase/cli 已登录（tcb login）。

set -euo pipefail

CF_DIR="$(cd "$(dirname "$0")" && pwd)"

# 游戏侧函数（openid 鉴权，不需要 password/token）
GAME_FUNCS=(login getProfile putProfile settle)
GAME_SHARED=(LadderSystem.js db.js settle-core.js)

# admin 侧函数（scrypt + JWT 鉴权，需要 password/token）
ADMIN_FUNCS=(adminLogin adminRouter)
ADMIN_SHARED=(LadderSystem.js db.js settle-core.js password.js token.js)

# 1. 同步 shared 到各函数（单一 source of truth = cloudfunctions/shared/）
echo "▶ 同步 shared/ 到各函数..."
for fn in "${GAME_FUNCS[@]}"; do
  mkdir -p "$CF_DIR/$fn/shared"
  for f in "${GAME_SHARED[@]}"; do cp "$CF_DIR/shared/$f" "$CF_DIR/$fn/shared/"; done
done
for fn in "${ADMIN_FUNCS[@]}"; do
  mkdir -p "$CF_DIR/$fn/shared"
  for f in "${ADMIN_SHARED[@]}"; do cp "$CF_DIR/shared/$f" "$CF_DIR/$fn/shared/"; done
done
echo "✓ shared 同步完成"

# 2. 部署
if [ $# -ge 1 ]; then
  echo "▶ 部署函数: $1"
  tcb fn deploy "$1" --force
else
  for fn in "${GAME_FUNCS[@]}" "${ADMIN_FUNCS[@]}"; do
    echo "▶ 部署函数: $fn"
    tcb fn deploy "$fn" --force
  done
fi

echo "✓ 全部完成"

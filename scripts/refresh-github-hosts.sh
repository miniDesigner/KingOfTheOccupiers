#!/usr/bin/env bash
# 刷新 GitHub 真实 IP 到 hosts，绕过内网 DNS 投毒。
#
# 背景：本沙箱所在的内网代理把 *.github.com 的 DNS 全部解析到 198.18.0.0/15
# （RFC 2544 保留的 benchmark 测试网段），TCP 能被中间设备假 accept，
# 但 TLS 握手立刻被 RST，git 报错：
#   gnutls_handshake() failed: The TLS connection was non-properly terminated.
# 绕过办法：用阿里公共 DNS（dns.alidns.com 在白名单内）查真实 IP，写进 hosts。
#
# 用法： bash scripts/refresh-github-hosts.sh
#       （GitHub 的 IP 会轮换，某天突然推不动了就跑一次）

set -uo pipefail

HOSTS_FILE="/etc/hosts"
USER_HOSTS="$HOME/.user_hosts"   # 本环境重启后 /etc/hosts 会被还原，需同步写这里
DOH="https://dns.alidns.com/resolve"

DOMAINS=(
  github.com
  codeload.github.com
  api.github.com
  objects.githubusercontent.com
  raw.githubusercontent.com
  avatars.githubusercontent.com
)

BEGIN="# >>> github-hosts-fix >>>"
END="# <<< github-hosts-fix <<<"

echo "查询中（走阿里公共 DNS）..."
lines=""
for d in "${DOMAINS[@]}"; do
  ip=$(curl -s --max-time 8 "${DOH}?name=${d}&type=A" \
        | python3 -c "
import sys, json
try:
    j = json.load(sys.stdin)
    ips = [a['data'] for a in j.get('Answer', []) if a.get('type') == 1]
    print(ips[0] if ips else '')
except Exception:
    print('')
")
  if [ -n "$ip" ]; then
    printf '  %-32s -> %s\n' "$d" "$ip"
    lines+="${ip} ${d}"$'\n'
  else
    echo "  ${d} -> 查询失败，跳过"
  fi
done

if [ -z "$lines" ]; then
  echo "❌ 一个 IP 都没拿到，可能 DoH 也不通了。保留原 hosts 不动。"
  exit 1
fi

block="${BEGIN}"$'\n'"${lines}${END}"

# 写持久化副本 ~/.user_hosts
touch "$USER_HOSTS"
python3 - "$USER_HOSTS" "$block" <<'PY'
import sys, re
path, block = sys.argv[1], sys.argv[2]
src = open(path, encoding='utf-8').read()
src = re.sub(r'# >>> github-hosts-fix >>>.*?# <<< github-hosts-fix <<<\n?',
             '', src, flags=re.S).rstrip('\n')
open(path, 'w', encoding='utf-8').write(src + '\n\n' + block + '\n')
PY

# 合并到 /etc/hosts（保留原有内容，去重）
python3 - "$USER_HOSTS" "$HOSTS_FILE" <<'PY'
import sys, re, socket
user_hosts, hosts_file = sys.argv[1], sys.argv[2]
extra = open(user_hosts, encoding='utf-8').read()
old = open(hosts_file, encoding='utf-8').read()
old = re.sub(r'# >>> github-hosts-fix >>>.*?# <<< github-hosts-fix <<<\n?', '', old, flags=re.S)
hostname = socket.gethostname()
kept = [l for l in old.splitlines()
        if l.strip() and not l.lstrip().startswith('#') and hostname not in l]
out = extra.rstrip('\n') + '\n' + '\n'.join(kept) + '\n' + \
      "# 以下为容器运行时必需，请勿删除\n%s\t%s\n" % (__import__('socket').gethostbyname(hostname), hostname)
open(hosts_file, 'w', encoding='utf-8').write(out)
PY

echo ""
echo "✅ 已写入 ~/.user_hosts 与 /etc/hosts"
echo ""
echo "验证："
python3 -c "
import socket
for d in ['github.com','api.github.com']:
    try:
        print('  %-16s -> %s' % (d, sorted({i[4][0] for i in socket.getaddrinfo(d,443,proto=socket.IPPROTO_TCP)})))
    except Exception as e:
        print('  %-16s -> %s' % (d, e))
"
echo ""
echo "通道自检（SSH 最稳，HTTPS 会有随机丢包）:"
timeout 20 ssh -T -o ConnectTimeout=10 git@github.com 2>&1 | head -2

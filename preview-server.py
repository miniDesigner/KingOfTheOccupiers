#!/usr/bin/env python3
"""带 no-cache 头的静态文件服务器，防止浏览器缓存 ES 模块"""
import http.server
import socketserver
import os
import sys

PORT = 8890
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 禁止缓存，确保每次请求都获取最新文件
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        # 根路径 / 或空路径 → 302 重定向到游戏入口 /preview/index.html（透传 query）
        # 兜底场景：手敲 host:8890 或复制老格式地址 (?room=XYZ) 也能直接进游戏
        # （默认 SimpleHTTPRequestHandler 对 / 返回目录列表，对手打开看到的是文件清单而非游戏）
        raw_path = self.path
        path_only = raw_path.split('?', 1)[0]
        if path_only in ('/', ''):
            target = '/preview/index.html'
            if '?' in raw_path:
                target += '?' + raw_path.split('?', 1)[1]
            self.send_response(302)
            self.send_header('Location', target)
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, format, *args):
        # 简洁日志
        sys.stdout.write(f"  {self.address_string()} - {format % args}\n")
        sys.stdout.flush()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    # ThreadingTCPServer: 多线程处理并发请求（浏览器的并行 fetch / keep-alive 不会阻塞服务器）
    # 绑定 0.0.0.0: 允许局域网内其他电脑访问（原为 127.0.0.1 仅本机）
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        # 打印本机局域网IP，方便其他电脑访问
        import socket as _socket
        try:
            _s = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
            _s.connect(("8.8.8.8", 80))
            lan_ip = _s.getsockname()[0]
            _s.close()
        except OSError:
            lan_ip = "未知(未联网)"
        print(f"[Server] Local:   http://localhost:{PORT}/preview/index.html")
        print(f"[Server] LAN:     http://{lan_ip}:{PORT}/preview/index.html  <- 其他电脑用这个")
        print(f"[Server] Serving from: {DIRECTORY}")
        print(f"[Server] Cache-Control: no-store (ES modules will not be cached)")
        print(f"[Server] Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[Server] Stopped.")

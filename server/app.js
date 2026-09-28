/**
 * app.js — 服务器入口（零 npm 依赖：node:http + node:sqlite + node:crypto）
 *
 * 启动：node app.js
 *  - REST API：/api/*
 *  - 运营后台静态页：/admin（浏览器访问 http://127.0.0.1:8891/admin）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initDb } from './db/index.js';
import { dispatch } from './routes/index.js';
import { PORT, HOST } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.join(__dirname, 'admin');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** 静态托管 admin 目录 */
function serveStatic(res, pathname) {
  let rel = pathname === '/admin' || pathname === '/admin/' ? '/index.html' : pathname.replace(/^\/admin\/?/, '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(ADMIN_DIR, rel);

  if (!filePath.startsWith(ADMIN_DIR)) { sendJson(res, 403, { error: 'forbidden' }); return; }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      fs.readFile(path.join(ADMIN_DIR, 'index.html'), (err2, html) => {
        if (err2) { sendJson(res, 404, { error: 'admin not found' }); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

function createHandler() {
  return async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/admin' || pathname.startsWith('/admin/')) { serveStatic(res, pathname); return; }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: '/admin' }); res.end(); return;
    }

    if (pathname.startsWith('/api/')) {
      try {
        const { status, data } = await dispatch(req, res);
        sendJson(res, status, data);
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) console.error('[server] unhandled error:', e);
        sendJson(res, status, { error: e.message || 'internal error', ...(e.extra ? e.extra : {}) });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  };
}

/** 启动服务器（initDb + listen），返回 http.Server */
export function startServer(port = PORT, host = HOST) {
  initDb();
  const server = http.createServer(createHandler());
  server.listen(port, host, () => {
    console.log(`[territory-king-server] listening on http://${host}:${port}`);
    console.log(`[territory-king-server] admin console: http://${host}:${port}/admin`);
  });
  return server;
}

// 直接运行（node app.js）时启动
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}

export { createHandler };

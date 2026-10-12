// Project Time —— 本地服务器
// 职责：1) 托管静态文件  2) 代理 DeepSeek API（key 只存服务端）  3) 本地 JSON 数据库
// 启动：node server.js  然后浏览器打开 http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');

// 读取 .env（DEEPSEEK_API_KEY=...）
function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch (_) { /* 无 .env 时忽略 */ }
}
loadEnv();
const API_KEY = process.env.DEEPSEEK_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', ...CORS });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { return send(res, 400, 'bad request', 'text/plain'); }

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // ---- DeepSeek 代理 ----
  if (pathname === '/api/ai' && req.method === 'POST') {
    if (!API_KEY) return send(res, 500, JSON.stringify({ error: '未配置 DEEPSEEK_API_KEY，请检查 .env' }));
    const body = await readBody(req);
    try {
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: 'deepseek-chat', ...body }),
      });
      const text = await upstream.text();
      send(res, upstream.status, text, 'application/json; charset=utf-8');
    } catch (e) {
      send(res, 502, JSON.stringify({ error: 'DeepSeek 请求失败：' + e.message }));
    }
    return;
  }

  // ---- 本地数据库 ----
  if (pathname === '/api/data') {
    if (req.method === 'GET') {
      try { send(res, 200, fs.readFileSync(DATA_FILE, 'utf8')); }
      catch (_) { send(res, 200, JSON.stringify({ events: [] })); }
    } else if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      try { fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2)); }
      catch (e) { return send(res, 500, JSON.stringify({ error: '写数据库失败：' + e.message })); }
      send(res, 200, JSON.stringify({ ok: true }));
    }
    return;
  }

  // ---- 静态文件 ----
  const rel = pathname === '/' ? '/index.html' : pathname;
  let fp;
  try { fp = path.normalize(path.join(ROOT, decodeURIComponent(rel))); }
  catch (_) { return send(res, 400, 'bad path', 'text/plain'); }
  if (!fp.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => console.log('Project Time 已启动：http://localhost:' + PORT));

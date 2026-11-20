// 不开 Premiere 看面板：node scripts/preview.mjs，然后打开 http://127.0.0.1:4180/?state=ready
// 用的是正式的界面代码，只把 Premiere 换成 preview/mock.js 里的假数据。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panel = path.join(root, 'extension', 'com.hechao.voiceover-namer');
const port = Number(process.env.PORT || 4180);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(panel, 'index.html'), 'utf8')
      .replace('<script src="js/main.js"></script>', '<script src="/preview/mock.js"></script>\n  <script src="js/main.js"></script>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (url.pathname.startsWith('/preview/')) file = path.join(root, decodeURIComponent(url.pathname));
  else file = path.join(panel, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`面板预览：http://127.0.0.1:${port}/?state=ready`));

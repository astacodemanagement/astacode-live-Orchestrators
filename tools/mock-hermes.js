// Uji kantor virtual TANPA Laravel:  node tools/mock-hermes.js   lalu buka http://localhost:8787/office/
// Kirim event:  curl -X POST localhost:8787/api/office/events -H "Content-Type: application/json" -d '{"type":"dm","agent":"seo_specialist","message":"Riset keyword"}'
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
const events = []; let seq = 0;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/office/events' && req.method === 'GET') {
    const after = url.searchParams.get('after');
    const list = after === null || after === '' || +after > seq ? [] : events.filter(e => e.id > +after);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ events: list, last_id: list.length ? list[list.length - 1].id : seq }));
  }
  if (url.pathname === '/api/office/events' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => {
      try { events.push({ ...JSON.parse(body), id: ++seq }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
      catch (e) { res.writeHead(400); res.end('JSON tidak valid'); }
    });
  }
  let file = path.normalize(path.join(root, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Tidak ditemukan'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8787, () => console.log('Kantor virtual: http://localhost:8787/office/'));

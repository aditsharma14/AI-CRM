// A static server that behaves like GitHub Pages for this repo: dist/ is served under /AI-CRM/, /AI-CRM/deals is
// dist/deals.html if there is one (status 200), and any other path gets dist/404.html with status 404. No dependencies.
//   node e2e-demo/pages-server.mjs [port]      after VITE_DEMO=true npm run build
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4176)
const ROOT = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BASE = '/AI-CRM/'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const send = (res, status, file) => {
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (path === '/AI-CRM') {
    res.writeHead(301, { location: BASE }).end()
    return
  }
  if (path.startsWith(BASE)) {
    let file = normalize(join(ROOT, path.slice(BASE.length)))
    if (file.startsWith(normalize(ROOT)) && existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html')
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`
    if (file.startsWith(normalize(ROOT)) && existsSync(file) && statSync(file).isFile()) return send(res, 200, file)
  }
  send(res, 404, join(ROOT, '404.html'))
}).listen(PORT, () => console.log(`pages-server: http://localhost:${PORT}${BASE} from ${ROOT}`))

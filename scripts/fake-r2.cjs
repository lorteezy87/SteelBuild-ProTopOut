/* In-memory S3-compatible server for local end-to-end runs (path-style PUT/GET only). Never used in production.
 * Usage: node scripts/fake-r2.cjs 9100   then start TopOut with R2_ENDPOINT=http://127.0.0.1:9100 */
const http = require("node:http");
const port = Number(process.argv[2] || 9100);
const store = new Map();
http
  .createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        store.set(key, { body: Buffer.concat(chunks), type: req.headers["content-type"] || "application/octet-stream" });
        res.writeHead(200, { ETag: '"fake"' }).end();
      });
      return;
    }
    const o = store.get(key);
    if (req.method === "GET" && o) return res.writeHead(200, { "Content-Type": o.type, "Content-Length": o.body.length }).end(o.body);
    res.writeHead(404).end();
  })
  .listen(port, () => console.log(`fake R2 on ${port}`));

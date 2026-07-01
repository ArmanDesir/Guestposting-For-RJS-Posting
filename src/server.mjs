import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(".");
const PUBLIC_DIR = join(ROOT, "ui");
const PORT = Number(process.env.RJS_UI_PORT || 3077);
let activeJob = null;
const jobs = [];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    return serveStatic(res, url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`RightJob syndication UI: http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, await getStatus());
  }

  if (req.method === "POST" && url.pathname === "/api/pull") {
    return runAction(res, "Pull latest", ["src/syndicate.mjs", "all"]);
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    return runAction(res, "Regenerate exports", ["src/syndicate.mjs", "export"]);
  }

  if (req.method === "POST" && url.pathname === "/api/schedule") {
    return runAction(res, "Run schedule", ["src/syndicate.mjs", "schedule"]);
  }

  if (req.method === "POST" && url.pathname === "/api/draft/devto") {
    const body = await readBody(req);
    if (!body.slug) return sendJson(res, 400, { error: "Missing slug." });
    return runAction(res, `Create DEV.to draft: ${body.slug}`, ["src/syndicate.mjs", "draft", "--platform", "devto", "--slug", body.slug]);
  }

  return sendJson(res, 404, { error: "Not found." });
}

async function getStatus() {
  const index = await readJson(join(ROOT, "data/index.json"), null);
  const calendar = await readJson(join(ROOT, "posting-calendar.json"), []);
  const schedulerState = await readJson(join(ROOT, "data/scheduler-state.json"), { completed: [] });
  const articles = await listArticles();
  return {
    index,
    articles,
    calendar,
    schedulerState,
    activeJob,
    jobs: jobs.slice(-20).reverse(),
    hasDevtoKey: Boolean((await readEnv()).DEVTO_API_KEY)
  };
}

async function listArticles() {
  const articlesDir = join(ROOT, "data/articles");
  try {
    const entries = await readdir(articlesDir, { withFileTypes: true });
    const articles = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(articlesDir, entry.name);
      const meta = await readJson(join(dir, "meta.json"), null);
      if (!meta) continue;
      articles.push({
        title: meta.title,
        slug: meta.slug,
        date: meta.date,
        excerpt: meta.excerpt,
        originalUrl: meta.originalUrl,
        categories: meta.categories || [],
        tags: meta.tags || [],
        devtoPath: `data/articles/${meta.slug}/platforms/devto.md`,
        hasDevtoDraft: await exists(join(dir, "platforms/devto.md"))
      });
    }
    return articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch {
    return [];
  }
}

function runAction(res, name, args) {
  if (activeJob) return sendJson(res, 409, { error: `Busy: ${activeJob.name}` });
  const job = {
    id: Date.now(),
    name,
    startedAt: new Date().toISOString(),
    status: "running",
    stdout: "",
    stderr: ""
  };
  activeJob = job;
  jobs.push(job);
  sendJson(res, 202, { job });

  const child = execFile(process.execPath, args, { cwd: ROOT, windowsHide: true });
  child.stdout.on("data", (chunk) => job.stdout += chunk.toString());
  child.stderr.on("data", (chunk) => job.stderr += chunk.toString());
  child.on("exit", (code) => {
    job.status = code === 0 ? "completed" : "failed";
    job.code = code;
    job.finishedAt = new Date().toISOString();
    activeJob = null;
  });
}

async function serveStatic(res, pathname) {
  const filePath = resolve(PUBLIC_DIR, "." + decodeURIComponent(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readEnv() {
  try {
    const env = {};
    const text = await readFile(join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

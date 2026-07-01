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

  if (req.method === "POST" && url.pathname === "/api/draft/medium") {
    const body = await readBody(req);
    if (!body.slug) return sendJson(res, 400, { error: "Missing slug." });
    return sendJson(res, 200, {
      status: "manual-only",
      message: "Medium browser automation is disabled. Use the Copy Medium button to copy the prepared draft and paste it into Medium."
    });
  }

  if (req.method === "GET" && url.pathname === "/api/platform/medium") {
    const slug = url.searchParams.get("slug");
    if (!isSafeSlug(slug)) return sendJson(res, 400, { error: "Missing or invalid slug." });
    const path = join(ROOT, "data/articles", slug, "platforms/medium.md");
    try {
      const markdown = await readFile(path, "utf8");
      const clipboard = mediumClipboardContent(markdown);
      return sendJson(res, 200, { slug, ...clipboard });
    } catch {
      return sendJson(res, 404, { error: "Medium draft file not found. Run Regenerate Drafts first." });
    }
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
        mediumPath: `data/articles/${meta.slug}/platforms/medium.md`,
        hasDevtoDraft: await exists(join(dir, "platforms/devto.md")),
        hasMediumDraft: await exists(join(dir, "platforms/medium.md"))
      });
    }
    return articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch {
    return [];
  }
}

function runAction(res, name, args, options = {}) {
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

  const executable = options.runtime === "direct" ? args[0] : process.execPath;
  const finalArgs = options.runtime === "direct" ? args.slice(1) : args;
  const child = execFile(executable, finalArgs, { cwd: ROOT, windowsHide: true });
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
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
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

function isSafeSlug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

function mediumClipboardContent(markdown) {
  const { title, body } = splitMediumFrontMatter(markdown);
  const cleanBody = body.trim();
  const withTitle = title ? `# ${title}\n\n${cleanBody}` : cleanBody;
  return {
    markdown: cleanBody,
    text: mediumPlainText(withTitle),
    html: mediumHtml(withTitle)
  };
}

function splitMediumFrontMatter(markdown) {
  const text = String(markdown);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*([\s\S]*)$/);
  if (!match) return { title: "", body: text };
  const titleMatch = match[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return {
    title: titleMatch ? titleMatch[1] : "",
    body: match[2]
  };
}

function mediumPlainText(markdown) {
  return String(markdown)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mediumHtml(markdown) {
  const blocks = String(markdown).replace(/\r/g, "").split(/\n{2,}/);
  const html = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 3);
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushList();
      html.push(`<figure><img src="${escapeAttrValue(image[2])}" alt="${escapeAttrValue(image[1])}"></figure>`);
      continue;
    }
    if (/^[-*]\s+/m.test(trimmed)) {
      const items = trimmed.split(/\n/).filter(Boolean).map((line) => line.replace(/^[-*]\s+/, "").trim());
      listItems.push(...items);
      continue;
    }
    if (trimmed === "---") {
      flushList();
      html.push("<hr>");
      continue;
    }
    flushList();
    html.push(`<p>${inlineMarkdownToHtml(trimmed.replace(/\n/g, " "))}</p>`);
  }
  flushList();
  return html.join("\n");
}

function inlineMarkdownToHtml(value) {
  return escapeHtmlText(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img src="$2" alt="$1">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2">$1</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function escapeHtmlText(value) {
  return String(value).replace(/[&<>]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;"
  }[char]));
}

function escapeAttrValue(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

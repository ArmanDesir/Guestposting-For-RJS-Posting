import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calendarKey,
  deleteScheduledPost,
  deleteScheduledPosts,
  insertScheduledPost,
  isSupabaseConfigured,
  listScheduledPosts,
  markScheduledPostCompletedById
} from "./supabase.mjs";

const ROOT = resolve(".");
const PUBLIC_DIR = join(ROOT, "ui");
const CALENDAR_FILE = join(ROOT, "posting-calendar.json");
const SCHEDULER_STATE_FILE = join(ROOT, "data/scheduler-state.json");
const PORT = Number(process.env.RJS_UI_PORT || 3077);
const SCHEDULER_INTERVAL_MS = Number(process.env.RJS_SCHEDULER_INTERVAL_MS || 60_000);
const ACTIVE_PLATFORMS = new Set(["devto", "medium", "hashnode", "tumblr", "hubspot", "substack", "quora"]);
const MANUAL_PLATFORM_URLS = {
  medium: "https://medium.com/new-story",
  hashnode: "https://hashnode.com/new",
  tumblr: "https://www.tumblr.com/new/text",
  hubspot: "https://app.hubspot.com/content/",
  substack: "https://substack.com/home",
  quora: "https://rightjobsupportsspace.quora.com/"
};
let activeJob = null;
let schedulerRunning = false;
let lastSchedulerRun = null;
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
  startSchedulerLoop();
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

  if (req.method === "POST" && url.pathname === "/api/calendar") {
    const body = await readBody(req);
    const env = await readEnv();
    const entry = normalizeCalendarEntry(body, env);
    if (entry.error) return sendJson(res, 400, { error: entry.error });
    if (isSupabaseConfigured(env)) {
      try {
        await insertScheduledPost(entry, env);
        return sendJson(res, 201, { entry, calendar: await listScheduledPosts(env), storage: "supabase" });
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message });
      }
    } else {
      const calendar = await readJson(CALENDAR_FILE, []);
      if (calendar.some((item) => calendarKey(item) === calendarKey(entry))) {
        return sendJson(res, 409, { error: "This schedule entry already exists." });
      }
      const updated = [...calendar, entry].sort((a, b) => new Date(a.date) - new Date(b.date));
      await writeFile(CALENDAR_FILE, JSON.stringify(updated, null, 2));
      return sendJson(res, 201, { entry, calendar: updated, storage: "local" });
    }
  }

  if (req.method === "DELETE" && url.pathname === "/api/calendar") {
    const id = url.searchParams.get("id");
    if (!id) return sendJson(res, 400, { error: "Missing schedule id." });
    const env = await readEnv();
    if (isSupabaseConfigured(env)) {
      try {
        await deleteScheduledPost(id, env);
        return sendJson(res, 200, { status: "cancelled", storage: "supabase" });
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message });
      }
    }

    const calendar = await readJson(CALENDAR_FILE, []);
    const schedulerState = await readJson(SCHEDULER_STATE_FILE, { completed: [] });
    const updated = calendar.filter((entry) => calendarKey(entry) !== id);
    if (updated.length === calendar.length) return sendJson(res, 404, { error: "Schedule entry not found." });
    await writeFile(CALENDAR_FILE, JSON.stringify(updated, null, 2));
    if ((schedulerState.completed || []).includes(id)) {
      const completed = (schedulerState.completed || []).filter((entryId) => entryId !== id);
      await writeFile(SCHEDULER_STATE_FILE, JSON.stringify({ ...schedulerState, completed, updatedAt: new Date().toISOString() }, null, 2));
    }
    return sendJson(res, 200, { status: "cancelled", storage: "local" });
  }

  if (req.method === "POST" && url.pathname === "/api/calendar/delete") {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.trim()) : [];
    if (!ids.length) return sendJson(res, 400, { error: "Select at least one schedule entry." });
    const env = await readEnv();

    if (isSupabaseConfigured(env)) {
      const results = await deleteScheduledPosts(ids, env);
      const failed = results.filter((result) => result.status === "failed");
      return sendJson(res, failed.length ? 207 : 200, {
        status: failed.length ? "partial" : "deleted",
        deleted: results.length - failed.length,
        failed
      });
    }

    const idSet = new Set(ids);
    const calendar = await readJson(CALENDAR_FILE, []);
    const schedulerState = await readJson(SCHEDULER_STATE_FILE, { completed: [] });
    const updated = calendar.filter((entry) => !idSet.has(calendarKey(entry)));
    const completed = (schedulerState.completed || []).filter((entryId) => !idSet.has(entryId));
    await writeFile(CALENDAR_FILE, JSON.stringify(updated, null, 2));
    await writeFile(SCHEDULER_STATE_FILE, JSON.stringify({ ...schedulerState, completed, updatedAt: new Date().toISOString() }, null, 2));
    return sendJson(res, 200, { status: "deleted", deleted: calendar.length - updated.length });
  }

  if (req.method === "POST" && url.pathname === "/api/calendar/complete") {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!id) return sendJson(res, 400, { error: "Missing schedule id." });
    const env = await readEnv();
    const result = {
      status: "manual-recorded",
      platform: body.platform || "",
      recordedAt: new Date().toISOString(),
      note: "Manual schedule/publish confirmed by user."
    };

    if (isSupabaseConfigured(env)) {
      try {
        await markScheduledPostCompletedById(id, result, env);
        return sendJson(res, 200, { status: "completed", storage: "supabase" });
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message });
      }
    }

    const schedulerState = await readJson(SCHEDULER_STATE_FILE, { completed: [] });
    const completed = [...new Set([...(schedulerState.completed || []), id])];
    await writeFile(SCHEDULER_STATE_FILE, JSON.stringify({ ...schedulerState, completed, updatedAt: new Date().toISOString() }, null, 2));
    return sendJson(res, 200, { status: "completed", storage: "local" });
  }

  if (req.method === "POST" && url.pathname === "/api/calendar/cancel-manual") {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!id) return sendJson(res, 400, { error: "Missing schedule id." });
    const env = await readEnv();
    const result = {
      status: "manual-cancelled",
      platform: body.platform || "",
      recordedAt: new Date().toISOString(),
      note: "Manual scheduled post cancellation confirmed by user."
    };

    if (isSupabaseConfigured(env)) {
      try {
        await markScheduledPostCompletedById(id, result, env);
        return sendJson(res, 200, { status: "cancelled", storage: "supabase" });
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message });
      }
    }

    const calendar = await readJson(CALENDAR_FILE, []);
    const updated = calendar.map((entry) => calendarKey(entry) === id ? {
      ...entry,
      status: "cancelled",
      completedAt: new Date().toISOString(),
      result
    } : entry);
    if (updated.every((entry) => calendarKey(entry) !== id && entry.id !== id)) {
      return sendJson(res, 404, { error: "Schedule entry not found." });
    }
    await writeFile(CALENDAR_FILE, JSON.stringify(updated, null, 2));
    return sendJson(res, 200, { status: "cancelled", storage: "local" });
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

  if (req.method === "GET" && url.pathname.startsWith("/api/platform/")) {
    const platform = url.pathname.split("/").pop();
    const slug = url.searchParams.get("slug");
    if (!ACTIVE_PLATFORMS.has(platform)) return sendJson(res, 400, { error: "Unsupported platform." });
    if (!isSafeSlug(slug)) return sendJson(res, 400, { error: "Missing or invalid slug." });
    const path = join(ROOT, "data/articles", slug, "platforms", `${platform}.md`);
    try {
      const markdown = await readFile(path, "utf8");
      const clipboard = mediumClipboardContent(markdown);
      return sendJson(res, 200, { slug, platform, openUrl: MANUAL_PLATFORM_URLS[platform] || "", ...clipboard });
    } catch {
      return sendJson(res, 404, { error: `${platform} draft file not found. Run Regenerate Drafts first.` });
    }
  }

  return sendJson(res, 404, { error: "Not found." });
}

async function getStatus() {
  const env = await readEnv();
  const index = await readJson(join(ROOT, "data/index.json"), null);
  const supabaseEnabled = isSupabaseConfigured(env);
  const calendar = supabaseEnabled ? await safeListScheduledPosts(env) : await readJson(join(ROOT, "posting-calendar.json"), []);
  const schedulerState = supabaseEnabled ? { completed: [] } : await readJson(join(ROOT, "data/scheduler-state.json"), { completed: [] });
  const articles = await listArticles();
  const enrichedCalendar = calendar.map((entry) => calendarStatus(entry, schedulerState));
  return {
    index,
    articles,
    calendar: enrichedCalendar,
    schedulerState,
    lastSchedulerRun,
    schedulerIntervalMs: SCHEDULER_INTERVAL_MS,
    activeJob,
    jobs: jobs.slice(-20).reverse(),
    hasDevtoKey: Boolean(env.DEVTO_API_KEY),
    hasHashnodeKey: Boolean(env.HASHNODE_API_KEY),
    hasSupabase: supabaseEnabled
  };
}

function calendarStatus(entry, schedulerState) {
  if (["completed", "failed", "cancelled"].includes(entry.status)) return entry;
  const completed = new Set(schedulerState.completed || []);
  const key = calendarKey(entry);
  const due = new Date(entry.date).getTime() <= Date.now();
  return {
    ...entry,
    id: key,
    status: completed.has(key) ? "completed" : due ? "due" : "pending"
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
  const job = startJob(name, args, options);
  sendJson(res, 202, { job });
}

function startSchedulerLoop() {
  if (process.env.RJS_AUTO_SCHEDULER === "false") {
    lastSchedulerRun = {
      status: "disabled",
      checkedAt: new Date().toISOString()
    };
    return;
  }
  setInterval(runSchedulerTick, SCHEDULER_INTERVAL_MS);
}

function runSchedulerTick() {
  if (schedulerRunning || activeJob) return;
  schedulerRunning = true;
  const job = startJob("Auto schedule", ["src/syndicate.mjs", "schedule"], { quietWhenIdle: true });
  job.onComplete = () => {
    schedulerRunning = false;
  };
}

function startJob(name, args, options = {}) {
  const job = {
    id: Date.now(),
    name,
    startedAt: new Date().toISOString(),
    status: "running",
    stdout: "",
    stderr: ""
  };
  activeJob = job;
  if (!options.quietWhenIdle) jobs.push(job);

  const executable = options.runtime === "direct" ? args[0] : process.execPath;
  const finalArgs = options.runtime === "direct" ? args.slice(1) : args;
  const child = execFile(executable, finalArgs, { cwd: ROOT, windowsHide: true });
  child.stdout.on("data", (chunk) => job.stdout += chunk.toString());
  child.stderr.on("data", (chunk) => job.stderr += chunk.toString());
  child.on("exit", (code) => {
    job.status = code === 0 ? "completed" : "failed";
    job.code = code;
    job.finishedAt = new Date().toISOString();
    lastSchedulerRun = name === "Auto schedule" ? schedulerSummary(job) : lastSchedulerRun;
    if (options.quietWhenIdle && shouldRecordQuietJob(job)) jobs.push(job);
    if (job.onComplete) job.onComplete(job);
    activeJob = null;
  });
  return job;
}

function shouldRecordQuietJob(job) {
  if (job.status !== "completed") return true;
  return !/No due schedule entries\./.test(job.stdout || "");
}

function schedulerSummary(job) {
  return {
    status: job.status,
    checkedAt: job.finishedAt || new Date().toISOString(),
    code: job.code,
    message: summarizeSchedulerOutput(job)
  };
}

function summarizeSchedulerOutput(job) {
  if (job.stderr) return job.stderr.trim().slice(0, 500);
  const stdout = (job.stdout || "").trim();
  if (!stdout) return "";
  if (/No due schedule entries\./.test(stdout)) return "No due schedule entries.";
  try {
    const results = JSON.parse(stdout);
    const total = Array.isArray(results) ? results.length : 0;
    const failed = Array.isArray(results) ? results.filter((entry) => entry.status === "failed").length : 0;
    return `${total} due item(s) processed${failed ? `, ${failed} failed` : ""}.`;
  } catch {
    return stdout.slice(0, 500);
  }
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
  const env = { ...process.env };
  try {
    const text = await readFile(join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return env;
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

function normalizeCalendarEntry(body, env = {}) {
  const slug = String(body.slug || "").trim();
  const platform = String(body.platform || "").trim().toLowerCase();
  const action = String(body.action || "manual").trim().toLowerCase();
  const date = new Date(body.date);
  const actions = new Set(["manual", "draft", "publish"]);
  if (!isSafeSlug(slug)) return { error: "Missing or invalid article slug." };
  if (!ACTIVE_PLATFORMS.has(platform)) return { error: "Unsupported platform." };
  if (!actions.has(action)) return { error: "Unsupported schedule action." };
  if (Number.isNaN(date.getTime())) return { error: "Invalid schedule date." };
  if (action !== "manual" && !apiConfigured(platform, env)) {
    return { error: `${platform} has no configured official API access. Use manual schedule for this platform.` };
  }
  return {
    date: date.toISOString(),
    slug,
    platform,
    action,
    createdAt: new Date().toISOString()
  };
}

function apiConfigured(platform, env) {
  return {
    devto: Boolean(env.DEVTO_API_KEY)
  }[platform] || false;
}

async function safeListScheduledPosts(env) {
  try {
    return await listScheduledPosts(env);
  } catch (error) {
    lastSchedulerRun = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      message: `Supabase calendar unavailable: ${error.message}`
    };
    return [];
  }
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

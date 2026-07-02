const MANUAL_METHOD = "Manual platforms use the Medium-style flow: prepare content, copy/export it, then schedule inside the website.";

const els = {
  summary: document.querySelector("#summary"),
  devtoKey: document.querySelector("#devtoKey"),
  scheduleStorage: document.querySelector("#scheduleStorage"),
  articleCount: document.querySelector("#articleCount"),
  activeJob: document.querySelector("#activeJob"),
  articles: document.querySelector("#articles"),
  log: document.querySelector("#log"),
  search: document.querySelector("#search"),
  pullBtn: document.querySelector("#pullBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  scheduleBtn: document.querySelector("#scheduleBtn"),
  scheduleForm: document.querySelector("#scheduleForm"),
  scheduleSlug: document.querySelector("#scheduleSlug"),
  schedulePlatform: document.querySelector("#schedulePlatform"),
  scheduleAction: document.querySelector("#scheduleAction"),
  scheduleDate: document.querySelector("#scheduleDate"),
  calendar: document.querySelector("#calendar"),
  history: document.querySelector("#history"),
  preview: document.querySelector("#preview"),
  notice: document.querySelector("#notice"),
  loader: document.querySelector("#loader")
};

let state = null;
let selectedSlug = "";
let noticeTimer = null;
let localLoading = false;

async function refresh({ quiet = false } = {}) {
  try {
    const response = await fetch("/api/status");
    state = await response.json();
    if (!selectedSlug) selectedSlug = state.articles?.[0]?.slug || "";
    render();
  } catch (error) {
    showNotice("Could not load dashboard status.", "error");
  } finally {
    if (!quiet && !state?.activeJob && !localLoading) setLoading(false);
  }
}

function render() {
  const articles = state.articles || [];
  els.articleCount.textContent = articles.length;
  els.devtoKey.textContent = state.hasDevtoKey ? "Configured" : "Missing";
  els.devtoKey.className = state.hasDevtoKey ? "" : "error";
  els.scheduleStorage.textContent = state.hasSupabase ? "Supabase" : "Local";
  els.activeJob.textContent = state.activeJob ? state.activeJob.name : "Idle";
  els.summary.textContent = state.index ? `${state.index.count} newsroom articles pulled from April 2026 onward.` : "Run Pull Latest to build the local archive.";

  renderArticleOptions(articles);
  renderArticles(articles);
  renderPreview();
  renderActionOptions();
  renderCalendar();
  renderLog();
  setBusyState(Boolean(state.activeJob));
  syncJobLoader();
}

function renderArticleOptions(articles) {
  const current = selectedSlug || els.scheduleSlug.value;
  els.scheduleSlug.innerHTML = articles.map((article) => (
    `<option value="${escapeAttr(article.slug)}">${escapeHtml(article.title)}</option>`
  )).join("");
  if (current && articles.some((article) => article.slug === current)) {
    els.scheduleSlug.value = current;
    selectedSlug = current;
  }
  if (!els.scheduleDate.value) els.scheduleDate.value = defaultScheduleDate();
}

function renderArticles(articles) {
  const query = els.search.value.trim().toLowerCase();
  const filtered = articles.filter((article) => {
    return !query || article.title.toLowerCase().includes(query) || article.slug.toLowerCase().includes(query);
  });

  els.articles.innerHTML = filtered.map((article) => `
    <button class="article-row ${article.slug === selectedSlug ? "selected" : ""}" data-select="${escapeAttr(article.slug)}" type="button">
      <span>
        <strong>${escapeHtml(article.title)}</strong>
        <small>${formatDate(article.date)}</small>
      </span>
    </button>
  `).join("");

  for (const button of document.querySelectorAll("[data-select]")) {
    button.addEventListener("click", () => selectArticle(button.dataset.select));
  }
}

function renderPreview() {
  const article = currentArticle();
  if (!article) {
    els.preview.className = "preview empty";
    els.preview.textContent = "Select an article to preview.";
    return;
  }
  els.preview.className = "preview";
  els.preview.innerHTML = `
    <div class="preview-head">
      <strong>${escapeHtml(article.title)}</strong>
      <a href="${escapeAttr(article.originalUrl)}" target="_blank" rel="noreferrer">Source</a>
    </div>
    <p>${escapeHtml(article.excerpt || "No excerpt available.")}</p>
    <div class="preview-actions">
      <button type="button" data-devto="${escapeAttr(article.slug)}">DEV.to draft</button>
      <button type="button" data-medium="${escapeAttr(article.slug)}">Copy Medium</button>
    </div>
  `;

  const devto = els.preview.querySelector("[data-devto]");
  const medium = els.preview.querySelector("[data-medium]");
  devto.addEventListener("click", () => run("/api/draft/devto", { slug: article.slug }, `Creating DEV.to draft for ${article.title}`));
  medium.addEventListener("click", () => prepareMedium(article.slug));
}

function renderActionOptions() {
  const platform = els.schedulePlatform.value;
  const isApiCapable = apiConfigured(platform);
  const options = [...els.scheduleAction.options];
  for (const option of options) {
    option.disabled = option.value !== "manual" && !isApiCapable;
  }
  if (!isApiCapable && els.scheduleAction.value !== "manual") {
    els.scheduleAction.value = "manual";
  }
  if (!isApiCapable) {
    showInlineNotice(MANUAL_METHOD);
  } else {
    showInlineNotice(`${platformLabel(platform)} can use API actions when credentials are configured. Manual schedule is still available.`);
  }
}

function apiConfigured(platform) {
  return {
    devto: Boolean(state?.hasDevtoKey),
    hashnode: Boolean(state?.hasHashnodeKey),
    forem: Boolean(state?.hasForemKey)
  }[platform] || false;
}

function renderCalendar() {
  const calendar = state.calendar || [];
  const activeEntries = calendar.filter((entry) => !["completed", "failed"].includes(entry.status));
  const historyEntries = calendar.filter((entry) => ["completed", "failed"].includes(entry.status)).reverse();
  els.calendar.innerHTML = activeEntries.length ? activeEntries.map(renderCalendarItem).join("") : `<div class="empty">No pending scheduled posts.</div>`;
  els.history.innerHTML = historyEntries.length ? historyEntries.map(renderCalendarItem).join("") : `<div class="empty">No completed or failed schedule entries yet.</div>`;

  for (const button of document.querySelectorAll("[data-cancel-schedule]")) {
    button.addEventListener("click", () => cancelSchedule(button.dataset.cancelSchedule));
  }
}

function renderCalendarItem(entry) {
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  const canCancel = ["pending", "due"].includes(entry.status);
  const error = entry.lastError ? `<span class="calendar-error">${escapeHtml(entry.lastError)}</span>` : "";
  return `
    <div class="calendar-item ${escapeHtml(entry.status)}">
      <div>
        <strong>${escapeHtml(article?.title || entry.slug)}</strong>
        <span>${platformLabel(entry.platform)} - ${actionLabel(entry.action)} - ${formatDateTime(entry.date)}</span>
        ${error}
      </div>
      <div class="calendar-controls">
        <b>${escapeHtml(entry.status)}</b>
        ${canCancel ? `<button type="button" class="danger small" data-cancel-schedule="${escapeAttr(entry.id)}">Cancel</button>` : ""}
      </div>
    </div>
  `;
}

function renderLog() {
  const jobs = state.jobs || [];
  els.log.textContent = jobs.length ? jobs.map(formatJob).join("\n\n") : "No recent activity.";
}

function setBusyState(busy) {
  for (const button of [els.pullBtn, els.exportBtn, els.scheduleBtn, ...document.querySelectorAll("button")]) {
    button.disabled = busy || button.disabled;
  }
  if (!busy) {
    for (const button of document.querySelectorAll("button")) button.disabled = false;
    renderActionOptions();
  }
}

function selectArticle(slug) {
  selectedSlug = slug;
  els.scheduleSlug.value = slug;
  render();
}

function currentArticle() {
  return (state.articles || []).find((article) => article.slug === selectedSlug || article.slug === els.scheduleSlug.value);
}

async function run(path, body = null, loadingText = "Working...") {
  localLoading = true;
  setLoading(true, loadingText);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      showNotice(payload.error || "Action failed.", "error");
      return;
    }
    showNotice(payload.message || "Action started.", "success");
    await refresh({ quiet: true });
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function addSchedule(event) {
  event.preventDefault();
  const slug = els.scheduleSlug.value.trim();
  const isoDate = localDateTimeToIso(els.scheduleDate.value);
  if (!slug) return showNotice("Select an article before scheduling.", "error");
  if (!isoDate) return showNotice("Select a valid schedule date and time.", "error");

  const body = {
    slug,
    platform: els.schedulePlatform.value,
    action: els.scheduleAction.value,
    date: isoDate
  };

  localLoading = true;
  setLoading(true, "Adding schedule...");
  try {
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || "Could not add schedule entry.", "error");
      return;
    }
    await refresh({ quiet: true });
    showNotice(`Scheduled ${currentArticle()?.title || slug} for ${platformLabel(body.platform)}.`, "success");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function cancelSchedule(id) {
  localLoading = true;
  setLoading(true, "Cancelling schedule...");
  try {
    const response = await fetch(`/api/calendar?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || "Could not cancel schedule entry.", "error");
      return;
    }
    await refresh({ quiet: true });
    showNotice("Schedule entry cancelled.", "success");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function prepareMedium(slug) {
  localLoading = true;
  setLoading(true, "Preparing Medium copy...");
  try {
    const response = await fetch(`/api/platform/medium?slug=${encodeURIComponent(slug)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || "Could not load Medium draft.", "error");
      return;
    }
    await writeRichClipboard(payload);
    window.open("https://medium.com/new-story", "_blank", "noopener,noreferrer");
    showNotice("Medium content copied. Paste it into the Medium editor and schedule manually.", "success");
  } catch {
    showNotice("Could not copy Medium content. Check browser clipboard permission.", "error");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function writeRichClipboard(payload) {
  if (window.ClipboardItem && payload.html) {
    const item = new ClipboardItem({
      "text/html": new Blob([payload.html], { type: "text/html" }),
      "text/plain": new Blob([payload.text || payload.markdown], { type: "text/plain" })
    });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(payload.text || payload.markdown);
}

function showNotice(message, type = "info") {
  clearTimeout(noticeTimer);
  els.notice.hidden = false;
  els.notice.className = `notice ${type}`;
  els.notice.textContent = message;
  noticeTimer = setTimeout(() => {
    els.notice.hidden = true;
  }, 7000);
}

function showInlineNotice(message) {
  if (!els.notice.hidden && els.notice.classList.contains("error")) return;
  els.notice.hidden = false;
  els.notice.className = "notice info";
  els.notice.textContent = message;
}

function setLoading(active, text = "Working...") {
  els.loader.hidden = !active;
  els.loader.querySelector("span").textContent = text;
}

function syncJobLoader() {
  if (state?.activeJob) {
    setLoading(true, `Working: ${state.activeJob.name}`);
    return;
  }
  if (!localLoading) setLoading(false);
}

function formatJob(job) {
  return [
    `[${job.status}] ${job.name}`,
    `Started: ${new Date(job.startedAt).toLocaleString()}`,
    job.finishedAt ? `Finished: ${new Date(job.finishedAt).toLocaleString()}` : "",
    job.stdout ? `\n${job.stdout.trim()}` : "",
    job.stderr ? `\nERROR:\n${job.stderr.trim()}` : ""
  ].filter(Boolean).join("\n");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function defaultScheduleDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toDateTimeLocal(date);
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function platformLabel(value) {
  return {
    devto: "DEV.to",
    medium: "Medium",
    hashnode: "Hashnode",
    tumblr: "Tumblr",
    forem: "Forem",
    hubspot: "HubSpot",
    substack: "Substack",
    quora: "Quora",
    hackernoon: "HackerNoon",
    wakelet: "Wakelet"
  }[value] || value;
}

function actionLabel(value = "manual") {
  return {
    manual: "Manual schedule",
    draft: "API draft",
    publish: "API publish"
  }[value] || value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

els.pullBtn.addEventListener("click", () => run("/api/pull", null, "Pulling latest newsroom articles..."));
els.exportBtn.addEventListener("click", () => run("/api/export", null, "Regenerating platform drafts..."));
els.scheduleBtn.addEventListener("click", () => run("/api/schedule", null, "Processing due scheduled posts..."));
els.scheduleForm.addEventListener("submit", addSchedule);
els.scheduleSlug.addEventListener("change", () => selectArticle(els.scheduleSlug.value));
els.schedulePlatform.addEventListener("change", renderActionOptions);
els.search.addEventListener("input", render);

refresh();
setInterval(() => refresh({ quiet: true }), 5000);

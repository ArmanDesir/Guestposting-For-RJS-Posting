const MANUAL_METHOD = "Manual platforms use the Medium-style flow: prepare content, copy/export it, then handle the final schedule or publish step inside the website.";
const API_PLATFORMS = new Set(["devto"]);
const MANUAL_SCHEDULE_PLATFORMS = new Set(["medium", "tumblr", "hubspot", "substack"]);
const MANUAL_PUBLISH_ONLY_PLATFORMS = new Set(["hashnode", "quora"]);

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
  scheduleHour: document.querySelector("#scheduleHour"),
  scheduleMinute: document.querySelector("#scheduleMinute"),
  scheduleAmPm: document.querySelector("#scheduleAmPm"),
  selectScheduledBtn: document.querySelector("#selectScheduledBtn"),
  clearScheduledBtn: document.querySelector("#clearScheduledBtn"),
  deleteScheduledBtn: document.querySelector("#deleteScheduledBtn"),
  selectHistoryBtn: document.querySelector("#selectHistoryBtn"),
  clearHistoryBtn: document.querySelector("#clearHistoryBtn"),
  deleteHistoryBtn: document.querySelector("#deleteHistoryBtn"),
  selectCancelledBtn: document.querySelector("#selectCancelledBtn"),
  clearCancelledBtn: document.querySelector("#clearCancelledBtn"),
  deleteCancelledBtn: document.querySelector("#deleteCancelledBtn"),
  calendar: document.querySelector("#calendar"),
  history: document.querySelector("#history"),
  cancelled: document.querySelector("#cancelled"),
  planner: document.querySelector("#planner"),
  plannerMode: document.querySelector("#plannerMode"),
  plannerMonth: document.querySelector("#plannerMonth"),
  plannerYear: document.querySelector("#plannerYear"),
  plannerTodayBtn: document.querySelector("#plannerTodayBtn"),
  preview: document.querySelector("#preview"),
  notice: document.querySelector("#notice"),
  loader: document.querySelector("#loader"),
  manualModal: document.querySelector("#manualModal"),
  manualModalText: document.querySelector("#manualModalText"),
  manualPublishedUrlWrap: document.querySelector("#manualPublishedUrlWrap"),
  manualPublishedUrl: document.querySelector("#manualPublishedUrl"),
  manualCancelBtn: document.querySelector("#manualCancelBtn"),
  manualConfirmSuccessBtn: document.querySelector("#manualConfirmSuccessBtn"),
  manualConfirmCancelBtn: document.querySelector("#manualConfirmCancelBtn"),
  manualOpenBtn: document.querySelector("#manualOpenBtn")
};

let state = null;
let selectedSlug = "";
let noticeTimer = null;
let localLoading = false;
let pendingManualEntry = null;
let pendingManualMode = "open";
let plannerCursor = new Date();
const selectedScheduleIds = new Set();

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
  renderPlannerControls();
  renderPlanner();
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
  if (!els.scheduleHour.options.length) populateTimeControls();
  if (!els.scheduleHour.value) setDefaultScheduleTime();
}

function renderArticles(articles) {
  const query = els.search.value.trim().toLowerCase();
  const filtered = articles.filter((article) => {
    return !query || article.title.toLowerCase().includes(query) || article.slug.toLowerCase().includes(query);
  });

  els.articles.innerHTML = filtered.map((article) => `
    <div class="article-row ${article.slug === selectedSlug ? "selected" : ""}">
      <button data-select="${escapeAttr(article.slug)}" type="button">
        <strong>${escapeHtml(article.title)}</strong>
        <small>${formatDate(article.date)}</small>
      </button>
      <a class="button-link small" href="${escapeAttr(article.originalUrl)}" target="_blank" rel="noreferrer">Source</a>
    </div>
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
      <a class="button-link" href="${escapeAttr(article.originalUrl)}" target="_blank" rel="noreferrer">Source article</a>
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
  const manualOption = options.find((option) => option.value === "manual");
  if (manualOption) manualOption.textContent = manualModeLabel(platform);
  for (const option of options) {
    option.disabled = option.value !== "manual" && !isApiCapable;
  }
  if (!isApiCapable && els.scheduleAction.value !== "manual") {
    els.scheduleAction.value = "manual";
  }
  if (!isApiCapable) {
    showInlineNotice(manualMethodNotice(platform));
  } else {
    showInlineNotice(`${platformLabel(platform)} can use API actions when credentials are configured. Manual schedule is still available.`);
  }
}

function apiConfigured(platform) {
  return platform === "devto" && Boolean(state?.hasDevtoKey);
}

function isManualEntry(entry) {
  return !API_PLATFORMS.has(entry.platform) || (entry.action || "manual") === "manual";
}

function renderCalendar() {
  const calendar = state.calendar || [];
  const activeEntries = calendar.filter((entry) => !isFinalStatus(entry.status));
  const historyEntries = calendar.filter((entry) => ["completed", "failed"].includes(entry.status)).reverse();
  const cancelledEntries = calendar.filter((entry) => entry.status === "cancelled").reverse();
  pruneSelectedScheduleIds(calendar);
  els.calendar.innerHTML = activeEntries.length ? activeEntries.map(renderCalendarItem).join("") : `<div class="empty">No pending scheduled posts.</div>`;
  els.history.innerHTML = historyEntries.length ? historyEntries.map(renderCalendarItem).join("") : `<div class="empty">No completed or failed schedule entries yet.</div>`;
  els.cancelled.innerHTML = cancelledEntries.length ? cancelledEntries.map(renderCalendarItem).join("") : `<div class="empty">No cancelled posts yet.</div>`;
  updateBulkButtons(activeEntries, historyEntries, cancelledEntries);

  for (const button of document.querySelectorAll("[data-cancel-schedule]")) {
    button.addEventListener("click", () => deleteScheduleIds([button.dataset.cancelSchedule], "Removing schedule entry..."));
  }
  for (const button of document.querySelectorAll("[data-cancel-manual-schedule]")) {
    button.addEventListener("click", () => showManualCancelWarning(button.dataset.cancelManualSchedule));
  }
  for (const checkbox of document.querySelectorAll("[data-select-schedule]")) {
    checkbox.addEventListener("change", () => toggleScheduleSelection(checkbox.dataset.selectSchedule, checkbox.checked));
  }
  for (const button of document.querySelectorAll("[data-open-manual]")) {
    button.addEventListener("click", () => showManualWarning(button.dataset.openManual));
  }
  for (const button of document.querySelectorAll("[data-record-manual]")) {
    button.addEventListener("click", () => showManualSuccessWarning(button.dataset.recordManual));
  }
  for (const button of document.querySelectorAll("[data-open-post]")) {
    button.addEventListener("click", () => openPostUrl(button.dataset.openPost));
  }
}

function renderCalendarItem(entry) {
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  const isActive = ["pending", "due"].includes(entry.status);
  const manualActive = isActive && isManualEntry(entry);
  const buttonLabel = isActive ? (manualActive ? "Cancel post" : "Cancel") : "Remove";
  const error = entry.lastError ? `<span class="calendar-error">${escapeHtml(entry.lastError)}</span>` : "";
  const postUrl = postUrlForEntry(entry);
  const manualControls = manualActive ? `
    <button type="button" class="small" data-open-manual="${escapeAttr(entry.id)}">Open</button>
    <button type="button" class="small success" data-record-manual="${escapeAttr(entry.id)}">Record success</button>
  ` : "";
  const openPostControl = postUrl && isFinalStatus(entry.status) ? `
    <button type="button" class="small" data-open-post="${escapeAttr(postUrl)}">Open post</button>
  ` : "";
  return `
    <div class="calendar-item ${escapeHtml(entry.status)}">
      <label class="select-box" title="Select schedule entry">
        <input type="checkbox" data-select-schedule="${escapeAttr(entry.id)}" ${selectedScheduleIds.has(entry.id) ? "checked" : ""}>
      </label>
      <div>
        <strong>${escapeHtml(article?.title || entry.slug)}</strong>
        <span>${platformLabel(entry.platform)} - ${entryActionLabel(entry)} - ${formatDateTime(entry.date)}</span>
        ${error}
      </div>
      <div class="calendar-controls">
        <b>${escapeHtml(statusLabel(entry))}</b>
        ${openPostControl}
        ${manualControls}
        <button type="button" class="danger small" ${manualActive ? `data-cancel-manual-schedule="${escapeAttr(entry.id)}"` : `data-cancel-schedule="${escapeAttr(entry.id)}"`}>${buttonLabel}</button>
      </div>
    </div>
  `;
}

function renderPlanner() {
  const entries = [...(state.calendar || [])]
    .filter((entry) => entry.status !== "cancelled")
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const visibleDays = plannerDays();

  const days = new Map();
  for (const entry of entries) {
    const key = dateKey(entry.date);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  }

  els.planner.className = "planner-grid calendar-grid";
  els.planner.innerHTML = `
    ${weekdayHeader().map((day) => `<div class="planner-weekday">${day}</div>`).join("")}
    ${visibleDays.map((day) => {
      const key = dateKey(day);
      const dayEntries = days.get(key) || [];
      const weekend = isWeekend(day);
      const outsideMonth = els.plannerMode.value === "month" && day.getMonth() !== plannerCursor.getMonth();
      return `
    <section class="planner-day ${weekend ? "disabled" : ""} ${outsideMonth ? "outside-month" : ""}">
      <header>
        <div>
          <strong>${escapeHtml(formatPlannerDay(day))}</strong>
          ${weekend ? `<small>Weekend disabled</small>` : ""}
        </div>
        <span>${dayEntries.length} post${dayEntries.length === 1 ? "" : "s"}</span>
      </header>
      <div class="planner-stack">
        ${dayEntries.length ? dayEntries.map(renderPlannerCard).join("") : `<div class="planner-empty">No posts</div>`}
      </div>
    </section>
      `;
    }).join("")}
  `;

  for (const button of document.querySelectorAll("[data-planner-open]")) {
    button.addEventListener("click", () => showManualWarning(button.dataset.plannerOpen));
  }
  for (const button of document.querySelectorAll("[data-planner-record]")) {
    button.addEventListener("click", () => showManualSuccessWarning(button.dataset.plannerRecord));
  }
  for (const button of document.querySelectorAll("[data-planner-cancel]")) {
    button.addEventListener("click", () => showManualCancelWarning(button.dataset.plannerCancel));
  }
  for (const button of document.querySelectorAll("[data-planner-post]")) {
    button.addEventListener("click", () => openPostUrl(button.dataset.plannerPost));
  }
}

function renderPlannerControls() {
  if (!els.plannerMonth.options.length) {
    const formatter = new Intl.DateTimeFormat([], { month: "long" });
    els.plannerMonth.innerHTML = Array.from({ length: 12 }, (_, index) => (
      `<option value="${index}">${formatter.format(new Date(2026, index, 1))}</option>`
    )).join("");
  }

  const calendarYears = (state.calendar || [])
    .map((entry) => new Date(entry.date).getFullYear())
    .filter((year) => Number.isFinite(year));
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear - 1, currentYear, currentYear + 1, ...calendarYears])].sort((a, b) => a - b);
  const selectedYear = plannerCursor.getFullYear();
  els.plannerYear.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  els.plannerMonth.value = String(plannerCursor.getMonth());
  els.plannerYear.value = String(years.includes(selectedYear) ? selectedYear : currentYear);
  els.plannerMonth.disabled = els.plannerMode.value !== "month";
  els.plannerYear.disabled = els.plannerMode.value !== "month";
}

function plannerDays() {
  if (els.plannerMode.value === "month") {
    const year = Number(els.plannerYear.value || plannerCursor.getFullYear());
    const month = Number(els.plannerMonth.value || plannerCursor.getMonth());
    const start = startOfWeek(new Date(year, month, 1));
    const end = endOfWeek(new Date(year, month + 1, 0));
    return dateRange(start, end);
  }

  const start = startOfWeek(plannerCursor);
  return Array.from({ length: 14 }, (_, index) => addDays(start, index));
}

function weekdayHeader() {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

function renderPlannerCard(entry) {
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  const manual = isManualEntry(entry);
  const active = ["pending", "due"].includes(entry.status);
  const postUrl = postUrlForEntry(entry);
  return `
    <article class="planner-card ${escapeHtml(entry.status)} ${manual ? "manual" : "api"}">
      <div class="planner-time">${escapeHtml(formatTime(entry.date))}</div>
      <div class="planner-body">
        <strong>${escapeHtml(article?.title || entry.slug)}</strong>
        <span>${platformLabel(entry.platform)} - ${entryActionLabel(entry)}</span>
      </div>
      <b>${escapeHtml(statusLabel(entry))}</b>
      ${postUrl && isFinalStatus(entry.status) ? `
        <div class="planner-actions">
          <button type="button" class="small" data-planner-post="${escapeAttr(postUrl)}">Open post</button>
        </div>
      ` : ""}
      ${manual && active ? `
        <div class="planner-actions">
          <button type="button" class="small" data-planner-open="${escapeAttr(entry.id)}">Open</button>
          <button type="button" class="danger small" data-planner-cancel="${escapeAttr(entry.id)}">Cancel post</button>
        </div>
      ` : ""}
    </article>
  `;
}

function pruneSelectedScheduleIds(calendar) {
  const validIds = new Set(calendar.map((entry) => entry.id));
  for (const id of [...selectedScheduleIds]) {
    if (!validIds.has(id)) selectedScheduleIds.delete(id);
  }
}

function toggleScheduleSelection(id, selected) {
  if (selected) selectedScheduleIds.add(id);
  else selectedScheduleIds.delete(id);
  renderCalendar();
}

function updateBulkButtons(activeEntries, historyEntries, cancelledEntries) {
  const activeSelected = selectedCount(activeEntries);
  const historySelected = selectedCount(historyEntries);
  const cancelledSelected = selectedCount(cancelledEntries);
  els.deleteScheduledBtn.textContent = activeSelected ? `Cancel selected (${activeSelected})` : "Cancel selected";
  els.deleteHistoryBtn.textContent = historySelected ? `Remove selected (${historySelected})` : "Remove selected";
  els.deleteCancelledBtn.textContent = cancelledSelected ? `Remove selected (${cancelledSelected})` : "Remove selected";
  els.deleteScheduledBtn.disabled = activeSelected === 0;
  els.deleteHistoryBtn.disabled = historySelected === 0;
  els.deleteCancelledBtn.disabled = cancelledSelected === 0;
  els.selectScheduledBtn.disabled = activeEntries.length === 0;
  els.clearScheduledBtn.disabled = activeSelected === 0;
  els.selectHistoryBtn.disabled = historyEntries.length === 0;
  els.clearHistoryBtn.disabled = historySelected === 0;
  els.selectCancelledBtn.disabled = cancelledEntries.length === 0;
  els.clearCancelledBtn.disabled = cancelledSelected === 0;
}

function selectedCount(entries) {
  return entries.filter((entry) => selectedScheduleIds.has(entry.id)).length;
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
    updateBulkButtonsFromState();
  }
}

function updateBulkButtonsFromState() {
  const calendar = state.calendar || [];
  updateBulkButtons(
    calendar.filter((entry) => !isFinalStatus(entry.status)),
    calendar.filter((entry) => ["completed", "failed"].includes(entry.status)),
    calendar.filter((entry) => entry.status === "cancelled")
  );
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
  const isoDate = scheduleControlsToIso();
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
    showNotice(`${scheduleCreatedLabel(body)} ${currentArticle()?.title || slug} for ${platformLabel(body.platform)}.`, "success");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function cancelSchedule(id) {
  return deleteScheduleIds([id], "Removing schedule entry...");
}

async function deleteSelectedSchedules(scope) {
  const entries = state.calendar || [];
  const scopedEntries = entries.filter((entry) => {
    if (scope === "history") return ["completed", "failed"].includes(entry.status);
    if (scope === "cancelled") return entry.status === "cancelled";
    return !isFinalStatus(entry.status);
  });
  const ids = scopedEntries.map((entry) => entry.id).filter((id) => selectedScheduleIds.has(id));
  if (!ids.length) return showNotice("Select at least one schedule entry.", "error");

  const loadingText = {
    history: "Removing selected history...",
    cancelled: "Removing selected cancelled posts...",
    active: "Cancelling selected schedules..."
  }[scope] || "Removing selected entries...";
  await deleteScheduleIds(ids, loadingText);
}

async function deleteScheduleIds(ids, loadingText) {
  localLoading = true;
  setLoading(true, loadingText);
  try {
    const response = await fetch("/api/calendar/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 207) {
      showNotice(payload.error || "Could not delete selected entries.", "error");
      return;
    }
    for (const id of ids) selectedScheduleIds.delete(id);
    await refresh({ quiet: true });
    const failed = payload.failed?.length || 0;
    showNotice(failed ? `Removed ${payload.deleted || 0}; ${failed} failed.` : `Removed ${payload.deleted || ids.length} schedule entry${(payload.deleted || ids.length) === 1 ? "" : "ies"}.`, failed ? "error" : "success");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

function selectScheduleScope(scope, selected) {
  const entries = state.calendar || [];
  for (const entry of entries) {
    const inScope = (
      (scope === "history" && ["completed", "failed"].includes(entry.status)) ||
      (scope === "cancelled" && entry.status === "cancelled") ||
      (scope === "active" && !isFinalStatus(entry.status))
    );
    if (inScope) {
      if (selected) selectedScheduleIds.add(entry.id);
      else selectedScheduleIds.delete(entry.id);
    }
  }
  renderCalendar();
}

async function prepareMedium(slug) {
  return prepareManualPlatform("medium", slug);
}

async function prepareManualPlatform(platform, slug) {
  localLoading = true;
  setLoading(true, `Preparing ${platformLabel(platform)} copy...`);
  try {
    const response = await fetch(`/api/platform/${encodeURIComponent(platform)}?slug=${encodeURIComponent(slug)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || `Could not load ${platformLabel(platform)} draft.`, "error");
      return;
    }
    await writeRichClipboard(payload);
    if (payload.openUrl) window.open(payload.openUrl, "_blank", "noopener,noreferrer");
    showNotice(`${platformLabel(platform)} content copied. ${manualNextStepLabel(platform)} Then record success here.`, "success");
  } catch {
    showNotice(`Could not copy ${platformLabel(platform)} content. Check browser clipboard permission.`, "error");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

function showManualWarning(id) {
  const entry = (state.calendar || []).find((item) => item.id === id);
  if (!entry) return showNotice("Schedule entry not found.", "error");
  pendingManualEntry = entry;
  pendingManualMode = "open";
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  els.manualModalText.textContent = `${platformLabel(entry.platform)} is a manual workflow. The draft will be copied and the platform page will open. ${manualModalNextStep(entry.platform)} Return here and click Record success for "${article?.title || entry.slug}" after the platform step is done.`;
  els.manualOpenBtn.textContent = "Copy and Open Platform";
  els.manualOpenBtn.hidden = false;
  els.manualPublishedUrlWrap.hidden = true;
  els.manualPublishedUrl.value = "";
  els.manualConfirmSuccessBtn.hidden = true;
  els.manualConfirmCancelBtn.hidden = true;
  els.manualModal.hidden = false;
}

function showManualSuccessWarning(id) {
  const entry = (state.calendar || []).find((item) => item.id === id);
  if (!entry) return showNotice("Schedule entry not found.", "error");
  pendingManualEntry = entry;
  pendingManualMode = "success";
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  els.manualModalText.textContent = `Confirm that "${article?.title || entry.slug}" has been ${manualCompletionVerb(entry.platform)} on ${platformLabel(entry.platform)}. Paste the final post URL if you have it, so the calendar can open it later.`;
  els.manualPublishedUrlWrap.hidden = false;
  els.manualPublishedUrl.value = "";
  els.manualOpenBtn.hidden = true;
  els.manualConfirmSuccessBtn.hidden = false;
  els.manualConfirmCancelBtn.hidden = true;
  els.manualModal.hidden = false;
}

function showManualCancelWarning(id) {
  const entry = (state.calendar || []).find((item) => item.id === id);
  if (!entry) return showNotice("Schedule entry not found.", "error");
  pendingManualEntry = entry;
  pendingManualMode = "cancel";
  const article = (state.articles || []).find((item) => item.slug === entry.slug);
  els.manualModalText.textContent = `${manualCancelInstruction(entry.platform)} After that, click Record Cancelled for "${article?.title || entry.slug}".`;
  els.manualOpenBtn.textContent = "Copy and Open Platform";
  els.manualOpenBtn.hidden = false;
  els.manualPublishedUrlWrap.hidden = true;
  els.manualPublishedUrl.value = "";
  els.manualConfirmSuccessBtn.hidden = true;
  els.manualConfirmCancelBtn.hidden = false;
  els.manualModal.hidden = false;
}

function closeManualModal() {
  pendingManualEntry = null;
  pendingManualMode = "open";
  els.manualModal.hidden = true;
  els.manualPublishedUrlWrap.hidden = true;
  els.manualPublishedUrl.value = "";
  els.manualOpenBtn.hidden = false;
  els.manualConfirmSuccessBtn.hidden = true;
  els.manualConfirmCancelBtn.hidden = true;
}

async function openPendingManualEntry() {
  if (!pendingManualEntry) return;
  const entry = pendingManualEntry;
  if (pendingManualMode !== "cancel") closeManualModal();
  await prepareManualPlatform(entry.platform, entry.slug);
}

async function confirmManualCancelled() {
  if (!pendingManualEntry) return;
  const entry = pendingManualEntry;
  closeManualModal();
  await recordManualCancelled(entry.id);
}

async function confirmManualSuccess() {
  if (!pendingManualEntry) return;
  const entry = pendingManualEntry;
  const publishedUrl = els.manualPublishedUrl.value.trim();
  if (publishedUrl && !isValidHttpUrl(publishedUrl)) {
    showNotice("Use a valid published URL or leave the field blank.", "error");
    return;
  }
  closeManualModal();
  await recordManualSuccess(entry.id, publishedUrl);
}

async function recordManualSuccess(id, publishedUrl = "") {
  const entry = (state.calendar || []).find((item) => item.id === id);
  if (!entry) return showNotice("Schedule entry not found.", "error");
  localLoading = true;
  setLoading(true, "Recording manual success...");
  try {
    const response = await fetch("/api/calendar/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, platform: entry.platform, publishedUrl })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || "Could not record manual success.", "error");
      return;
    }
    await refresh({ quiet: true });
    showNotice(`${platformLabel(entry.platform)} manual schedule recorded.`, "success");
  } finally {
    localLoading = false;
    syncJobLoader();
  }
}

async function recordManualCancelled(id) {
  const entry = (state.calendar || []).find((item) => item.id === id);
  if (!entry) return showNotice("Schedule entry not found.", "error");
  localLoading = true;
  setLoading(true, "Recording manual cancellation...");
  try {
    const response = await fetch("/api/calendar/cancel-manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, platform: entry.platform })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(payload.error || "Could not record manual cancellation.", "error");
      return;
    }
    await refresh({ quiet: true });
    showNotice(`${platformLabel(entry.platform)} manual cancellation recorded.`, "success");
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
  return value ? new Date(value).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }) : "-";
}

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }) : "-";
}

function isFinalStatus(status) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function statusLabel(entry) {
  if (entry.status === "completed") return "Success";
  if (entry.status === "cancelled") return "Cancelled";
  if (entry.status === "failed") return "Failed";
  if (entry.status === "due") return "Due";
  return "Pending";
}

function postUrlForEntry(entry) {
  const result = entry.result || {};
  return result.publishedUrl || result.url || result.draftUrl || result.canonicalUrl || "";
}

function openPostUrl(url) {
  if (!url) return showNotice("No published post URL is stored for this entry.", "error");
  window.open(url, "_blank", "noopener,noreferrer");
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatPlannerDay(value) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function defaultScheduleDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toDateInput(date);
}

function populateTimeControls() {
  els.scheduleHour.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const hour = index + 1;
    return `<option value="${hour}">${hour}</option>`;
  }).join("");
  els.scheduleMinute.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const minute = String(index * 5).padStart(2, "0");
    return `<option value="${minute}">${minute}</option>`;
  }).join("");
  setDefaultScheduleTime();
}

function setDefaultScheduleTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  els.scheduleHour.value = String(hour12);
  els.scheduleMinute.value = String(date.getMinutes()).padStart(2, "0");
  els.scheduleAmPm.value = hour24 >= 12 ? "PM" : "AM";
}

function toDateInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function scheduleControlsToIso() {
  if (!els.scheduleDate.value) return "";
  let hour = Number(els.scheduleHour.value);
  const minute = Number(els.scheduleMinute.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  if (els.scheduleAmPm.value === "PM" && hour !== 12) hour += 12;
  if (els.scheduleAmPm.value === "AM" && hour === 12) hour = 0;
  const [year, month, day] = els.scheduleDate.value.split("-").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function startOfWeek(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function endOfWeek(value) {
  return addDays(startOfWeek(value), 6);
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateRange(start, end) {
  const days = [];
  for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
    days.push(new Date(day));
  }
  return days;
}

function isWeekend(value) {
  const day = value.getDay();
  return day === 0 || day === 6;
}

function platformLabel(value) {
  return {
    devto: "DEV.to",
    medium: "Medium",
    hashnode: "Hashnode",
    tumblr: "Tumblr",
    hubspot: "HubSpot",
    substack: "Substack",
    quora: "Quora"
  }[value] || value;
}

function actionLabel(value = "manual") {
  return {
    manual: "Manual schedule",
    draft: "API draft",
    publish: "API publish"
  }[value] || value;
}

function manualModeLabel(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) return "Manual publish reminder";
  return "Manual schedule";
}

function manualMethodNotice(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) {
    return `${platformLabel(platform)} does not provide a reliable scheduling workflow for this system. Add it as a publish reminder, publish manually at the scheduled time, then record success here.`;
  }
  if (MANUAL_SCHEDULE_PLATFORMS.has(platform)) {
    return `${platformLabel(platform)} is handled manually: copy/open the draft, schedule it inside the platform, then record success here.`;
  }
  return MANUAL_METHOD;
}

function manualNextStepLabel(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) return "Publish manually at the reminder time.";
  return "Schedule or publish manually inside the website.";
}

function manualModalNextStep(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) {
    return "Use this as a publish reminder because the platform does not support reliable scheduled publishing here.";
  }
  return "Schedule or publish it inside the platform.";
}

function manualCompletionVerb(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) return "published manually";
  return "scheduled or published successfully";
}

function manualCancelInstruction(platform) {
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(platform)) {
    return `Before recording this as cancelled, confirm you will not publish this reminder on ${platformLabel(platform)}.`;
  }
  return `Before recording this as cancelled, open ${platformLabel(platform)} and cancel or remove the scheduled draft manually.`;
}

function entryActionLabel(entry) {
  if ((entry.action || "manual") === "manual") return manualModeLabel(entry.platform);
  return actionLabel(entry.action);
}

function scheduleCreatedLabel(entry) {
  if ((entry.action || "manual") !== "manual") return "Scheduled";
  if (MANUAL_PUBLISH_ONLY_PLATFORMS.has(entry.platform)) return "Added publish reminder for";
  return "Added manual schedule for";
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
els.plannerMode.addEventListener("change", () => {
  renderPlannerControls();
  renderPlanner();
});
els.plannerMonth.addEventListener("change", () => {
  plannerCursor = new Date(Number(els.plannerYear.value), Number(els.plannerMonth.value), 1);
  renderPlanner();
});
els.plannerYear.addEventListener("change", () => {
  plannerCursor = new Date(Number(els.plannerYear.value), Number(els.plannerMonth.value), 1);
  renderPlannerControls();
  renderPlanner();
});
els.plannerTodayBtn.addEventListener("click", () => {
  plannerCursor = new Date();
  els.plannerMode.value = "two-weeks";
  renderPlannerControls();
  renderPlanner();
});
els.search.addEventListener("input", render);
els.selectScheduledBtn.addEventListener("click", () => selectScheduleScope("active", true));
els.clearScheduledBtn.addEventListener("click", () => selectScheduleScope("active", false));
els.deleteScheduledBtn.addEventListener("click", () => deleteSelectedSchedules("active"));
els.selectHistoryBtn.addEventListener("click", () => selectScheduleScope("history", true));
els.clearHistoryBtn.addEventListener("click", () => selectScheduleScope("history", false));
els.deleteHistoryBtn.addEventListener("click", () => deleteSelectedSchedules("history"));
els.selectCancelledBtn.addEventListener("click", () => selectScheduleScope("cancelled", true));
els.clearCancelledBtn.addEventListener("click", () => selectScheduleScope("cancelled", false));
els.deleteCancelledBtn.addEventListener("click", () => deleteSelectedSchedules("cancelled"));
els.manualCancelBtn.addEventListener("click", closeManualModal);
els.manualConfirmSuccessBtn.addEventListener("click", confirmManualSuccess);
els.manualConfirmCancelBtn.addEventListener("click", confirmManualCancelled);
els.manualOpenBtn.addEventListener("click", openPendingManualEntry);
for (const tab of document.querySelectorAll("[data-view-tab]")) {
  tab.addEventListener("click", () => setView(tab.dataset.viewTab));
}

refresh();
setInterval(() => refresh({ quiet: true }), 5000);

function setView(view) {
  for (const tab of document.querySelectorAll("[data-view-tab]")) {
    tab.classList.toggle("selected", tab.dataset.viewTab === view);
  }
  for (const panel of document.querySelectorAll("[data-view]")) {
    panel.hidden = panel.dataset.view !== view;
  }
}

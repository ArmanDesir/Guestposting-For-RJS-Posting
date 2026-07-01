const els = {
  summary: document.querySelector("#summary"),
  devtoKey: document.querySelector("#devtoKey"),
  articleCount: document.querySelector("#articleCount"),
  lastPull: document.querySelector("#lastPull"),
  activeJob: document.querySelector("#activeJob"),
  articles: document.querySelector("#articles"),
  log: document.querySelector("#log"),
  search: document.querySelector("#search"),
  pullBtn: document.querySelector("#pullBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  scheduleBtn: document.querySelector("#scheduleBtn")
};

let state = null;

async function refresh() {
  const response = await fetch("/api/status");
  state = await response.json();
  render();
}

function render() {
  const articles = state.articles || [];
  els.articleCount.textContent = articles.length;
  els.devtoKey.textContent = state.hasDevtoKey ? "Configured" : "Missing";
  els.devtoKey.className = state.hasDevtoKey ? "" : "error";
  els.lastPull.textContent = state.index?.pulledAt ? new Date(state.index.pulledAt).toLocaleString() : "-";
  els.activeJob.textContent = state.activeJob ? state.activeJob.name : "Idle";
  els.summary.textContent = state.index ? `Newsroom source: ${state.index.source} · ${state.index.count} pulled` : "Run Pull Latest to build the local archive.";

  const busy = Boolean(state.activeJob);
  for (const button of [els.pullBtn, els.exportBtn, els.scheduleBtn, ...document.querySelectorAll("[data-draft]")]) {
    button.disabled = busy;
  }

  const query = els.search.value.trim().toLowerCase();
  const filtered = articles.filter(article => {
    return !query || article.title.toLowerCase().includes(query) || article.slug.toLowerCase().includes(query);
  });

  els.articles.innerHTML = filtered.map(article => `
    <tr>
      <td>
        <div class="title">${escapeHtml(article.title)}</div>
        <div class="meta">${escapeHtml(article.slug)} · ${escapeHtml((article.tags || []).slice(0, 4).join(", "))}</div>
      </td>
      <td>${formatDate(article.date)}</td>
      <td>
        <div class="row-actions">
          <button data-draft="${escapeHtml(article.slug)}">Create Draft</button>
          <a class="link" href="${escapeAttr(article.originalUrl)}" target="_blank" rel="noreferrer">Source</a>
        </div>
      </td>
    </tr>
  `).join("");

  for (const button of document.querySelectorAll("[data-draft]")) {
    button.addEventListener("click", () => run(`/api/draft/devto`, { slug: button.dataset.draft }));
  }

  const jobs = state.jobs || [];
  els.log.textContent = jobs.length ? jobs.map(formatJob).join("\n\n") : "No jobs yet.";
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

async function run(path, body = null) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok && response.status !== 202) {
    const payload = await response.json().catch(() => ({}));
    alert(payload.error || "Action failed.");
  }
  await refresh();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
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

els.pullBtn.addEventListener("click", () => run("/api/pull"));
els.exportBtn.addEventListener("click", () => run("/api/export"));
els.scheduleBtn.addEventListener("click", () => run("/api/schedule"));
els.search.addEventListener("input", render);

refresh();
setInterval(refresh, 3000);

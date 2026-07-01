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
  for (const button of [els.pullBtn, els.exportBtn, els.scheduleBtn, ...document.querySelectorAll("[data-devto]"), ...document.querySelectorAll("[data-medium]")]) {
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
          <button data-devto="${escapeHtml(article.slug)}">DEV.to</button>
          <button data-medium="${escapeHtml(article.slug)}"> Medium</button>
          <a class="link" href="${escapeAttr(article.originalUrl)}" target="_blank" rel="noreferrer">Source</a>
        </div>
      </td>
    </tr>
  `).join("");

  for (const button of document.querySelectorAll("[data-devto]")) {
    button.addEventListener("click", () => run(`/api/draft/devto`, { slug: button.dataset.devto }));
  }

  for (const button of document.querySelectorAll("[data-medium]")) {
    button.addEventListener("click", () => prepareMedium(button.dataset.medium));
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

async function prepareMedium(slug) {
  const response = await fetch(`/api/platform/medium?slug=${encodeURIComponent(slug)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showTemporaryLog(payload.error || "Could not load Medium draft.");
    return;
  }
  showMediumWarning(slug, payload);
}

function showMediumWarning(slug, payload) {
  const existing = document.querySelector(".medium-warning-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "medium-warning-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;";

  const card = document.createElement("div");
  card.style.cssText = "max-width:500px;width:100%;background:#fff;color:#111;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);padding:24px;font-family:system-ui, sans-serif;line-height:1.5;";

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
      <div style="font-size:28px;line-height:1;">⚠️</div>
      <div>
        <h2 style="margin:0 0 8px;font-size:1.2rem;">Ready to open Medium</h2>
        <p style="margin:0;color:#333;">This will copy your draft to the clipboard automatically. After Medium opens, paste it into the editor with <strong>Ctrl+V</strong> (or Cmd+V on macOS).</p>
      </div>
    </div>
    <div style="margin-bottom:20px;color:#555;">If you want to stop, click Cancel. Otherwise click Continue to proceed.</div>
  `;

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;";

  const continueButton = document.createElement("button");
  continueButton.textContent = "Continue to Medium";
  continueButton.style.cssText = "background:#0a84ff;color:#fff;border:none;padding:12px 18px;border-radius:10px;cursor:pointer;";

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Cancel";
  cancelButton.style.cssText = "background:#f2f2f2;color:#111;border:none;padding:12px 18px;border-radius:10px;cursor:pointer;";

  actions.append(cancelButton, continueButton);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const removeOverlay = () => {
    overlay.remove();
  };

  cancelButton.addEventListener("click", () => {
    removeOverlay();
    showTemporaryLog(`Medium draft canceled for ${slug}.`);
  });

  continueButton.addEventListener("click", async () => {
    continueButton.disabled = true;
    cancelButton.disabled = true;
    continueButton.textContent = "Preparing draft...";
    try {
      await writeMediumClipboard(payload);
      removeOverlay();
      window.open("https://medium.com/new-story", "_blank", "noopener,noreferrer");
      showTemporaryLog(`Copied Medium PNG-ready draft for ${slug}.\nThen press Ctrl+V inside the Medium editor.`);
    } catch (error) {
      removeOverlay();
      showTemporaryLog(`Failed to write Medium draft to clipboard.`);
    }
  });
}

async function writeMediumClipboard(payload) {
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

function showTemporaryLog(message) {
  els.log.textContent = message;
  setTimeout(render, 3500);
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

const CALENDAR_TABLE = "scheduled_posts";

export function isSupabaseConfigured(env = process.env) {
  return Boolean(env.SUPABASE_URL && supabaseServerKey(env));
}

export function calendarKey(entry) {
  return `${entry.date}|${entry.slug}|${entry.platform}|${entry.action || "manual"}`;
}

export async function listScheduledPosts(env = process.env) {
  const rows = await supabaseRequest(
    `/${CALENDAR_TABLE}?select=*&order=date.asc`,
    { method: "GET" },
    env
  );
  return rows.map(rowToCalendarEntry);
}

export async function insertScheduledPost(entry, env = process.env) {
  const row = calendarEntryToRow(entry);
  try {
    const rows = await supabaseRequest(
      `/${CALENDAR_TABLE}`,
      {
        method: "POST",
        headers: { "prefer": "return=representation" },
        body: JSON.stringify(row)
      },
      env
    );
    return rowToCalendarEntry(rows[0]);
  } catch (error) {
    if (error.status === 409) {
      const existingRows = await supabaseRequest(
        `/${CALENDAR_TABLE}?id=eq.${encodeURIComponent(row.id)}&select=*`,
        { method: "GET" },
        env
      );
      const existing = existingRows?.[0] ? rowToCalendarEntry(existingRows[0]) : null;
      if (existing && ["completed", "failed", "cancelled"].includes(existing.status)) {
        const rows = await supabaseRequest(
          `/${CALENDAR_TABLE}?id=eq.${encodeURIComponent(row.id)}`,
          updateOptions({
            date: row.date,
            slug: row.slug,
            platform: row.platform,
            action: row.action,
            status: "pending",
            created_at: row.created_at,
            completed_at: null,
            last_error: null,
            result: null
          }),
          env
        );
        return rowToCalendarEntry(rows[0]);
      }
      const duplicate = new Error("This schedule entry already exists.");
      duplicate.status = 409;
      throw duplicate;
    }
    throw error;
  }
}

export async function deleteScheduledPost(id, env = process.env) {
  const rows = await deleteScheduledPostById(id, env);
  if (rows?.length) return;

  const fallbackRows = await deleteScheduledPostByParts(id, env);
  if (fallbackRows?.length) return;

  const error = new Error("Schedule entry was not found.");
  error.status = 404;
  throw error;
}

async function deleteScheduledPostById(id, env) {
  return supabaseRequest(
    `/${CALENDAR_TABLE}?id=eq.${encodeURIComponent(id)}`,
    deleteOptions(),
    env
  );
}

async function deleteScheduledPostByParts(id, env) {
  const [rawDate, slug, platform, action = "manual"] = String(id).split("|");
  if (!rawDate || !slug || !platform) return [];
  const date = new Date(rawDate);
  const dateCandidates = [
    rawDate,
    Number.isNaN(date.getTime()) ? "" : date.toISOString(),
    Number.isNaN(date.getTime()) ? "" : date.toISOString().replace(".000Z", "+00:00")
  ].filter(Boolean);

  for (const candidate of [...new Set(dateCandidates)]) {
    const query = [
      `date=eq.${encodeURIComponent(candidate)}`,
      `slug=eq.${encodeURIComponent(slug)}`,
      `platform=eq.${encodeURIComponent(platform)}`,
      `action=eq.${encodeURIComponent(action)}`
    ].join("&");
    const rows = await supabaseRequest(`/${CALENDAR_TABLE}?${query}`, deleteOptions(), env);
    if (rows?.length) return rows;
  }
  return [];
}

function deleteOptions() {
  return {
    method: "DELETE",
    headers: { "prefer": "return=representation" }
  };
}

export async function deleteScheduledPosts(ids, env = process.env) {
  const results = [];
  for (const id of ids) {
    try {
      await deleteScheduledPost(id, env);
      results.push({ id, status: "deleted" });
    } catch (error) {
      results.push({ id, status: "failed", error: error.message });
    }
  }
  return results;
}

export async function listDueScheduledPosts(nowIso = new Date().toISOString(), env = process.env) {
  const query = [
    "select=*",
    "status=eq.pending",
    "action=neq.manual",
    `date=lte.${encodeURIComponent(nowIso)}`,
    "order=date.asc"
  ].join("&");
  const rows = await supabaseRequest(`/${CALENDAR_TABLE}?${query}`, { method: "GET" }, env);
  return rows.map(rowToCalendarEntry);
}

export async function markScheduledPostCompleted(entry, result, env = process.env) {
  await updateScheduledPost(entry, {
    status: "completed",
    completed_at: new Date().toISOString(),
    last_error: null,
    result
  }, env);
}

export async function markScheduledPostCompletedById(id, result, env = process.env) {
  await updateScheduledPost({ id }, {
    status: "completed",
    completed_at: new Date().toISOString(),
    last_error: null,
    result
  }, env);
}

export async function markScheduledPostFailed(entry, result, env = process.env) {
  await updateScheduledPost(entry, {
    status: "failed",
    last_error: result?.error || result?.reason || "Schedule action failed.",
    result
  }, env);
}

export async function supabaseRequest(path, options = {}, env = process.env) {
  if (!isSupabaseConfigured(env)) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": supabaseServerKey(env),
      "authorization": `Bearer ${supabaseServerKey(env)}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    const error = new Error(body?.message || body?.hint || text || `Supabase request failed: ${response.status}`);
    error.status = response.status;
    error.body = body || text;
    throw error;
  }
  return body;
}

function supabaseServerKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
}

async function updateScheduledPost(entry, patch, env) {
  const id = entry.id || calendarKey(entry);
  const rows = await updateScheduledPostById(id, patch, env);
  if (rows?.length) return rows;

  const fallbackRows = await updateScheduledPostByParts(id, patch, env);
  if (fallbackRows?.length) return fallbackRows;

  const error = new Error("Schedule entry was not found.");
  error.status = 404;
  throw error;
}

async function updateScheduledPostById(id, patch, env) {
  return supabaseRequest(
    `/${CALENDAR_TABLE}?id=eq.${encodeURIComponent(id)}`,
    updateOptions(patch),
    env
  );
}

async function updateScheduledPostByParts(id, patch, env) {
  const [rawDate, slug, platform, action = "manual"] = String(id).split("|");
  if (!rawDate || !slug || !platform) return [];
  const date = new Date(rawDate);
  const dateCandidates = [
    rawDate,
    Number.isNaN(date.getTime()) ? "" : date.toISOString(),
    Number.isNaN(date.getTime()) ? "" : date.toISOString().replace(".000Z", "+00:00")
  ].filter(Boolean);

  for (const candidate of [...new Set(dateCandidates)]) {
    const query = [
      `date=eq.${encodeURIComponent(candidate)}`,
      `slug=eq.${encodeURIComponent(slug)}`,
      `platform=eq.${encodeURIComponent(platform)}`,
      `action=eq.${encodeURIComponent(action)}`
    ].join("&");
    const rows = await supabaseRequest(`/${CALENDAR_TABLE}?${query}`, updateOptions(patch), env);
    if (rows?.length) return rows;
  }
  return [];
}

function updateOptions(patch) {
  return {
    method: "PATCH",
    headers: { "prefer": "return=representation" },
    body: JSON.stringify(patch)
  };
}

function calendarEntryToRow(entry) {
  return {
    id: calendarKey(entry),
    date: entry.date,
    slug: entry.slug,
    platform: entry.platform,
    action: entry.action || "manual",
    status: entry.status || "pending",
    created_at: entry.createdAt || new Date().toISOString()
  };
}

function rowToCalendarEntry(row) {
  const resultStatus = row.result?.status || "";
  const status = resultStatus === "manual-cancelled" ? "cancelled" : row.status || "pending";
  return {
    id: row.id,
    date: row.date,
    slug: row.slug,
    platform: row.platform,
    action: row.action || "manual",
    status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    result: row.result
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

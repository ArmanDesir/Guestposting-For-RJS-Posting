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
      const duplicate = new Error("This schedule entry already exists.");
      duplicate.status = 409;
      throw duplicate;
    }
    throw error;
  }
}

export async function listDueScheduledPosts(nowIso = new Date().toISOString(), env = process.env) {
  const query = [
    "select=*",
    "status=eq.pending",
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
  const id = encodeURIComponent(calendarKey(entry));
  await supabaseRequest(
    `/${CALENDAR_TABLE}?id=eq.${id}`,
    {
      method: "PATCH",
      headers: { "prefer": "return=minimal" },
      body: JSON.stringify(patch)
    },
    env
  );
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
  return {
    id: row.id,
    date: row.date,
    slug: row.slug,
    platform: row.platform,
    action: row.action || "manual",
    status: row.status || "pending",
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

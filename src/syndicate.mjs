import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  calendarKey,
  isSupabaseConfigured,
  insertScheduledPost,
  listDueScheduledPosts,
  listScheduledPosts,
  markScheduledPostCompleted,
  markScheduledPostFailed
} from "./supabase.mjs";

const SITE = "https://rightjobsolutions.com";
const POSTS_API = `${SITE}/wp-json/wp/v2/posts`;
const CATEGORIES_API = `${SITE}/wp-json/wp/v2/categories`;
const TAGS_API = `${SITE}/wp-json/wp/v2/tags`;
const HASHNODE_API = "https://gql.hashnode.com/";
const MIN_PUBLISHED_DATE = "2026-04-01T00:00:00";
const DATA_DIR = "data";
const ARTICLES_DIR = join(DATA_DIR, "articles");
const CALENDAR_FILE = "posting-calendar.json";
const STATE_FILE = join(DATA_DIR, "scheduler-state.json");
const USER_AGENT = "RightJobSolutions-Syndication/1.0 (+https://rightjobsolutions.com)";
const PLATFORMS = ["devto", "medium", "hashnode", "tumblr", "hubspot", "substack", "quora"];
const API_PLATFORMS = new Set(["devto"]);

async function main() {
  await loadEnvFile();
  const command = process.argv[2] || "all";
  if (command === "pull") await pullArticles();
  else if (command === "export") await exportAllPlatformDrafts();
  else if (command === "queue") await createPostingQueue(parseArgs(process.argv.slice(3)));
  else if (command === "draft") await createDraftFromArgs(parseArgs(process.argv.slice(3)));
  else if (command === "schedule") await runScheduler();
  else if (command === "sync-calendar") await syncCalendarToSupabase();
  else if (command === "all") {
    await pullArticles();
    await exportAllPlatformDrafts();
  } else if (command === "check") await check();
  else {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  }
}

async function loadEnvFile() {
  try {
    const text = await readFile(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional. Credentials should still come from environment variables only.
  }
}

async function pullArticles() {
  await mkdir(ARTICLES_DIR, { recursive: true });
  const [categories, tags, posts] = await Promise.all([
    fetchTerms(CATEGORIES_API),
    fetchTerms(TAGS_API),
    fetchPosts()
  ]);

  for (const post of posts) {
    await saveArticle(post, categories, tags);
  }

  await writeFile(
    join(DATA_DIR, "index.json"),
    JSON.stringify({
      source: `${SITE}/newsroom/`,
      minPublishedDate: MIN_PUBLISHED_DATE,
      pulledAt: new Date().toISOString(),
      count: posts.length,
      slugs: posts.map((post) => post.slug)
    }, null, 2)
  );

  console.log(`Pulled ${posts.length} published articles into ${ARTICLES_DIR}`);
}

async function fetchPosts() {
  const posts = [];
  let page = 1;
  while (true) {
    const url = `${POSTS_API}?status=publish&after=${encodeURIComponent(MIN_PUBLISHED_DATE)}&per_page=100&page=${page}&_embed=1`;
    const { json, headers } = await fetchJson(url);
    posts.push(...json);
    const totalPages = Number(headers.get("x-wp-totalpages") || page);
    if (page >= totalPages || json.length === 0) break;
    page += 1;
  }
  return posts;
}

async function fetchTerms(endpoint) {
  const terms = new Map();
  let page = 1;
  while (true) {
    const url = `${endpoint}?per_page=100&page=${page}`;
    const { json, headers } = await fetchJson(url);
    for (const term of json) terms.set(term.id, term.name);
    const totalPages = Number(headers.get("x-wp-totalpages") || page);
    if (page >= totalPages || json.length === 0) break;
    page += 1;
  }
  return terms;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${url}`);
  }
  return { json: await response.json(), headers: response.headers };
}

async function saveArticle(post, categoryMap, tagMap) {
  const articleDir = join(ARTICLES_DIR, post.slug);
  const imagesDir = join(articleDir, "images");
  await mkdir(imagesDir, { recursive: true });

  const categories = (post.categories || []).map((id) => categoryMap.get(id)).filter(Boolean);
  const tags = (post.tags || []).map((id) => tagMap.get(id)).filter(Boolean);
  const title = decodeHtml(stripTags(post.title?.rendered || ""));
  const excerpt = cleanExcerpt(post.excerpt?.rendered || post.yoast_head_json?.description || "");
  const originalUrl = post.link || post.yoast_head_json?.canonical;
  const featured = getFeaturedImage(post);
  const contentImages = extractImages(post.content?.rendered || "");
  const allImages = uniqueImages([featured, ...contentImages].filter(Boolean));

  let featuredImage = null;
  if (featured?.url) {
    featuredImage = await downloadImage(featured.url, articleDir, "featured-image");
  }

  const downloadedImages = [];
  for (const image of allImages) {
    if (image.url === featured?.url) continue;
    const saved = await downloadImage(image.url, imagesDir);
    if (saved) downloadedImages.push({ ...image, localPath: normalizePath(saved) });
  }

  const markdownBody = htmlToMarkdown(post.content?.rendered || "", articleDir);
  const canonicalBlock = `\n\n---\n\nCanonical source: [${title}](${originalUrl})\n`;
  const articleMarkdown = [
    frontMatter({
      title,
      slug: post.slug,
      date: post.date_gmt || post.date,
      modified: post.modified_gmt || post.modified,
      original_url: originalUrl,
      excerpt,
      categories,
      tags,
      featured_image: featuredImage ? normalizePath(featuredImage) : null
    }),
    "",
    markdownBody.trim(),
    canonicalBlock.trim(),
    ""
  ].join("\n");

  const meta = {
    id: post.id,
    title,
    slug: post.slug,
    date: post.date_gmt || post.date,
    modified: post.modified_gmt || post.modified,
    excerpt,
    bodyHtml: post.content?.rendered || "",
    categories,
    tags,
    images: downloadedImages,
    featuredImage: featuredImage ? normalizePath(featuredImage) : null,
    featuredImageSource: featured?.url || null,
    originalUrl,
    sourceApiUrl: `${POSTS_API}/${post.id}`,
    pulledAt: new Date().toISOString()
  };

  await writeFile(join(articleDir, "article.md"), articleMarkdown);
  await writeFile(join(articleDir, "meta.json"), JSON.stringify(meta, null, 2));
}

function getFeaturedImage(post) {
  const media = post._embedded?.["wp:featuredmedia"]?.[0];
  const url = media?.source_url || post.yoast_head_json?.og_image?.[0]?.url;
  if (!url) return null;
  return {
    url,
    alt: media?.alt_text || post.title?.rendered || "",
    caption: stripTags(media?.caption?.rendered || "")
  };
}

function extractImages(html) {
  const images = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const url = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src");
    if (!url) continue;
    images.push({
      url: absolutize(url),
      alt: decodeHtml(attr(tag, "alt") || ""),
      title: decodeHtml(attr(tag, "title") || "")
    });
  }
  return images;
}

function uniqueImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image?.url || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

async function downloadImage(url, dir, preferredName = "") {
  try {
    await mkdir(dir, { recursive: true });
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok || !response.body) {
      console.warn(`Skipped image ${url}: ${response.status} ${response.statusText}`);
      return null;
    }
    const contentType = response.headers.get("content-type") || "";
    const extension = extensionFor(url, contentType);
    const rawName = preferredName || basename(new URL(url).pathname).replace(extname(new URL(url).pathname), "");
    const safeName = slugify(rawName || "image");
    const target = join(dir, `${safeName}${extension}`);
    await pipeline(response.body, createWriteStream(target));
    return target;
  } catch (error) {
    console.warn(`Skipped image ${url}: ${error.message}`);
    return null;
  }
}

function extensionFor(url, contentType) {
  const fromUrl = extname(new URL(url).pathname);
  if (fromUrl) return fromUrl;
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("gif")) return ".gif";
  return ".img";
}

async function exportAllPlatformDrafts() {
  const slugs = await listArticleSlugs();
  for (const slug of slugs) {
    const article = await loadArticle(slug);
    await exportPlatformDrafts(article);
  }
  console.log(`Exported ${slugs.length} article(s) for ${PLATFORMS.join(", ")}`);
}

async function createPostingQueue(options) {
  await mkdir(DATA_DIR, { recursive: true });
  const platform = options.platform || "devto";
  const intervalDays = Number(options["interval-days"] || 1);
  const limit = Number(options.limit || 0);
  const start = parseStartDate(options.start || "now");

  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}. Use one of: ${PLATFORMS.join(", ")}`);
  }

  const articles = [];
  for (const slug of await listArticleSlugs()) {
    articles.push(await loadArticle(slug));
  }
  articles.sort((a, b) => new Date(b.meta.date).getTime() - new Date(a.meta.date).getTime());

  const selected = limit > 0 ? articles.slice(0, limit) : articles;
  const existing = await readJson(CALENDAR_FILE, []);
  const existingKeys = new Set(existing.map(calendarKey));
  const entries = [];

  selected.forEach((article, index) => {
    const date = new Date(start.getTime() + index * intervalDays * 24 * 60 * 60 * 1000);
    const entry = {
      date: date.toISOString(),
      slug: article.meta.slug,
      platform,
      action: options.action || "manual"
    };
    const key = calendarKey(entry);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      entries.push(entry);
    }
  });

  const updatedCalendar = [...existing, ...entries];
  await writeFile(CALENDAR_FILE, JSON.stringify(updatedCalendar, null, 2));
  await writeFile(
    join(DATA_DIR, "posting-queue.json"),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      platform,
      action: options.action || "manual",
      intervalDays,
      added: entries.length,
      calendarFile: CALENDAR_FILE,
      entries
    }, null, 2)
  );

  console.log(`Added ${entries.length} ${options.action || "manual"} ${platform} queue item(s) to ${CALENDAR_FILE}`);
}

async function createDraftFromArgs(options) {
  const platform = options.platform || "devto";
  if (!API_PLATFORMS.has(platform)) {
    throw new Error("Direct API drafting is currently only available for configured API platforms.");
  }
  if (!options.slug) {
    throw new Error("Missing --slug for draft command.");
  }
  const article = await loadArticle(options.slug);
  await exportPlatformDrafts(article);
  const result = await createDevtoDraft(article);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}

async function exportPlatformDrafts(article) {
  const platformsDir = join(article.dir, "platforms");
  await mkdir(platformsDir, { recursive: true });
  const body = cleanSyndicationMarkdown(stripExistingCanonical(article.markdown));
  const mediumBody = prepareMediumBody(article, body);
  const manualBody = prepareManualBody(article, body);
  const devtoBody = await prepareDevtoBody(article, body);

  const exports = {
    devto: devtoDraft(article, devtoBody),
    medium: mediumDraft(article, mediumBody),
    hashnode: hashnodeDraft(article, manualBody),
    tumblr: tumblrDraft(article, manualBody),
    hubspot: manualPlatformDraft(article, manualBody, "hubspot"),
    substack: manualPlatformDraft(article, manualBody, "substack"),
    quora: manualPlatformDraft(article, manualBody, "quora")
  };

  for (const [platform, content] of Object.entries(exports)) {
    await writeFile(join(platformsDir, `${platform}.md`), content);
  }
}

function prepareMediumBody(article, body) {
  return replaceImageMarkdown(body, article, (sourceUrl) => imageProxyUrl(sourceUrl, "png"));
}

function prepareManualBody(article, body) {
  return replaceImageMarkdown(body, article, (sourceUrl) => imageProxyUrl(sourceUrl, "png"));
}

function mediumDraft(article, body) {
  return [
    frontMatter({
      title: article.meta.title,
      canonical_url: article.meta.originalUrl,
      tags: article.meta.tags.slice(0, 5),
      publish_status: "draft"
    }),
    "",
    body,
    canonicalLink(article),
    ""
  ].join("\n");
}

function tumblrDraft(article, body) {
  return [
    frontMatter({
      title: article.meta.title,
      source_url: article.meta.originalUrl,
      tags: article.meta.tags,
      format: "markdown"
    }),
    "",
    body,
    canonicalLink(article),
    ""
  ].join("\n");
}

function devtoDraft(article, body) {
  return [
    "---",
    `title: ${yamlString(article.meta.title)}`,
    "published: false",
    `canonical_url: ${yamlString(article.meta.originalUrl)}`,
    `description: ${yamlString(article.meta.excerpt)}`,
    `tags: ${devtoTags(article).join(", ")}`,
    "---",
    "",
    body,
    canonicalLink(article),
    ""
  ].join("\n");
}

function hashnodeDraft(article, body) {
  return [
    frontMatter({
      title: article.meta.title,
      subtitle: article.meta.excerpt,
      canonical_url: article.meta.originalUrl,
      tags: article.meta.tags,
      publish_as: "draft"
    }),
    "",
    body,
    canonicalLink(article),
    ""
  ].join("\n");
}

function manualPlatformDraft(article, body, platform) {
  return [
    frontMatter({
      title: article.meta.title,
      canonical_url: article.meta.originalUrl,
      source_url: article.meta.originalUrl,
      platform,
      publish_as: "manual"
    }),
    "",
    body,
    canonicalLink(article),
    ""
  ].join("\n");
}

async function runScheduler() {
  await mkdir(DATA_DIR, { recursive: true });
  const supabaseEnabled = isSupabaseConfigured();
  const calendar = supabaseEnabled ? await safeListDueScheduledPosts() : await readJson(CALENDAR_FILE, []);
  const state = supabaseEnabled ? { completed: [] } : await readJson(STATE_FILE, { completed: [] });
  const completed = new Set(state.completed || []);
  const now = Date.now();
  const results = [];

  for (const entry of calendar) {
    const id = calendarKey(entry);
    if (completed.has(id)) continue;
    if (!supabaseEnabled && new Date(entry.date).getTime() > now) continue;
    const result = await handleScheduleEntry(entry);
    results.push({ id, ...result });
    if (supabaseEnabled) {
      if (result.status === "failed") await markScheduledPostFailed(entry, result);
      else await markScheduledPostCompleted(entry, result);
    } else if (result.status !== "failed") {
      completed.add(id);
    }
  }

  if (!supabaseEnabled) {
    await writeFile(STATE_FILE, JSON.stringify({ completed: [...completed], updatedAt: new Date().toISOString() }, null, 2));
  }
  console.log(results.length ? JSON.stringify(results, null, 2) : "No due schedule entries.");
}

async function syncCalendarToSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  const localCalendar = await readJson(CALENDAR_FILE, []);
  const remoteCalendar = await listScheduledPosts();
  const remoteKeys = new Set(remoteCalendar.map(calendarKey));
  let added = 0;
  let skipped = 0;

  for (const entry of localCalendar) {
    if (remoteKeys.has(calendarKey(entry))) {
      skipped += 1;
      continue;
    }
    await insertScheduledPost(entry);
    added += 1;
  }

  console.log(`Synced calendar to Supabase. Added: ${added}. Skipped: ${skipped}.`);
}

async function safeListDueScheduledPosts() {
  try {
    return await listDueScheduledPosts();
  } catch (error) {
    console.warn(`Supabase scheduler unavailable: ${error.message}`);
    return [];
  }
}

async function handleScheduleEntry(entry) {
  if (!PLATFORMS.includes(entry.platform)) {
    return { status: "failed", reason: `Unsupported platform: ${entry.platform}` };
  }

  const article = await loadArticle(entry.slug);
  await exportPlatformDrafts(article);

  if ((entry.action || "manual") === "draft") {
    if (entry.platform === "devto") return createDevtoDraft(article);
    return {
      status: "manual-export-ready",
      platform: entry.platform,
      reason: "No working API is configured for this platform. Medium-style manual export is ready.",
      title: article.meta.title,
      originalUrl: article.meta.originalUrl,
      file: normalizePath(join(article.dir, "platforms", `${entry.platform}.md`))
    };
  }

  if ((entry.action || "manual") === "publish") {
    if (entry.platform === "devto") return createDevtoPublish(article);
    return {
      status: "manual-export-ready",
      platform: entry.platform,
      reason: "No working API is configured for this platform. Medium-style manual export is ready.",
      title: article.meta.title,
      originalUrl: article.meta.originalUrl,
      file: normalizePath(join(article.dir, "platforms", `${entry.platform}.md`))
    };
  }

  return {
    status: "manual-export-ready",
    platform: entry.platform,
    title: article.meta.title,
    originalUrl: article.meta.originalUrl,
    file: normalizePath(join(article.dir, "platforms", `${entry.platform}.md`))
  };
}

async function createHashnodeDraft(article) {
  if (!process.env.HASHNODE_API_KEY) {
    return manualApiFallback(article, "hashnode", "Missing HASHNODE_API_KEY environment variable.");
  }

  try {
    const publicationId = await resolveHashnodePublicationId();
    const input = hashnodePostInput(article, publicationId);
    const response = await hashnodeRequest(
      `mutation CreateDraft($input: CreateDraftInput!) {
        createDraft(input: $input) {
          draft {
            id
            slug
            title
            canonicalUrl
          }
        }
      }`,
      { input }
    );
    const draft = response?.createDraft?.draft;
    return {
      status: "api-draft-created",
      platform: "hashnode",
      title: article.meta.title,
      id: draft?.id || "",
      slug: draft?.slug || "",
      draftUrl: draft?.slug ? `https://hashnode.com/draft/${draft.slug}` : ""
    };
  } catch (error) {
    return hashnodeFailure(article, error);
  }
}

async function createHashnodePublish(article) {
  if (!process.env.HASHNODE_API_KEY) {
    return manualApiFallback(article, "hashnode", "Missing HASHNODE_API_KEY environment variable.");
  }

  try {
    const publicationId = await resolveHashnodePublicationId();
    const input = {
      ...hashnodePostInput(article, publicationId),
      publishedAt: new Date().toISOString(),
      settings: {
        enableTableOfContent: true,
        isNewsletterActivated: false,
        delisted: false
      }
    };
    const response = await hashnodeRequest(
      `mutation PublishPost($input: PublishPostInput!) {
        publishPost(input: $input) {
          post {
            id
            slug
            title
            url
            canonicalUrl
          }
        }
      }`,
      { input }
    );
    const post = response?.publishPost?.post;
    return {
      status: "api-published",
      platform: "hashnode",
      title: article.meta.title,
      id: post?.id || "",
      slug: post?.slug || "",
      draftUrl: post?.url || ""
    };
  } catch (error) {
    return hashnodeFailure(article, error);
  }
}

function hashnodePostInput(article, publicationId) {
  const body = replaceImageMarkdown(stripExistingCanonical(article.markdown), article, (sourceUrl) => imageProxyUrl(sourceUrl, "png"));
  const featuredImageUrl = article.meta.featuredImageSource || resolveArticleImageUrl(article, article.meta.featuredImage || "");
  return removeEmptyValues({
    title: article.meta.title,
    subtitle: article.meta.excerpt,
    publicationId,
    contentMarkdown: `${body}${canonicalLink(article)}`,
    slug: article.meta.slug,
    originalArticleURL: article.meta.originalUrl,
    tags: hashnodeTags(article),
    coverImageOptions: featuredImageUrl ? { coverImageURL: imageProxyUrl(featuredImageUrl, "png") } : undefined,
    settings: {
      enableTableOfContent: true,
      activateNewsletter: false,
      delist: false,
      slugOverridden: true
    }
  });
}

function hashnodeTags(article) {
  const tags = article.meta.tags
    .map((tag) => ({ name: String(tag).trim(), slug: slugify(tag).slice(0, 50) }))
    .filter((tag) => tag.name && tag.slug);
  return [...new Map(tags.map((tag) => [tag.slug, tag])).values()].slice(0, 5);
}

async function resolveHashnodePublicationId() {
  if (process.env.HASHNODE_PUBLICATION_ID) return process.env.HASHNODE_PUBLICATION_ID;
  const response = await hashnodeRequest(
    `query CurrentUserPublications {
      me {
        id
        publications(first: 10) {
          edges {
            node {
              id
              title
              url
            }
          }
        }
      }
    }`
  );
  const publication = response?.me?.publications?.edges?.[0]?.node;
  if (!publication?.id) {
    throw new Error("No editable Hashnode publication found for this token. Set HASHNODE_PUBLICATION_ID in .env if needed.");
  }
  return publication.id;
}

async function hashnodeRequest(query, variables = {}) {
  const response = await fetch(HASHNODE_API, {
    method: "POST",
    headers: {
      "authorization": process.env.HASHNODE_API_KEY,
      "content-type": "application/json",
      "accept": "application/json",
      "user-agent": USER_AGENT
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  const json = safeJson(text);
  if (!json) {
    const title = text.match(/<title>([^<]+)<\/title>/i)?.[1];
    throw new Error(`Hashnode returned non-JSON response${title ? `: ${title}` : ""}. API access may require a paid Hashnode plan.`);
  }
  if (!response.ok || json.errors?.length) {
    const message = json.errors?.map((error) => error.message).join("; ") || text.slice(0, 1000);
    throw new Error(`Hashnode API failed (${response.status}): ${message}`);
  }
  return json.data;
}

function hashnodeFailure(article, error) {
  return {
    status: "failed",
    platform: "hashnode",
    title: article.meta.title,
    error: error.message,
    file: normalizePath(join(article.dir, "platforms", "hashnode.md"))
  };
}

function manualApiFallback(article, platform, reason) {
  return {
    status: "manual-export-ready",
    platform,
    reason,
    title: article.meta.title,
    originalUrl: article.meta.originalUrl,
    file: normalizePath(join(article.dir, "platforms", `${platform}.md`))
  };
}

async function createDevtoDraft(article) {
  return createDevtoArticle(article, false);
}

async function createDevtoPublish(article) {
  return createDevtoArticle(article, true);
}

async function createDevtoArticle(article, published) {
  if (!process.env.DEVTO_API_KEY) {
    return {
      status: "manual-export-ready",
      platform: "devto",
      reason: "Missing DEVTO_API_KEY environment variable.",
      title: article.meta.title,
      originalUrl: article.meta.originalUrl,
      file: normalizePath(join(article.dir, "platforms", "devto.md"))
    };
  }

  const bodyMarkdown = await prepareDevtoBody(article, stripExistingCanonical(article.markdown));
  const response = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": process.env.DEVTO_API_KEY,
      "content-type": "application/json",
      "user-agent": USER_AGENT
    },
    body: JSON.stringify({
      article: {
        title: article.meta.title,
        published,
        body_markdown: bodyMarkdown + canonicalLink(article),
        canonical_url: article.meta.originalUrl,
        description: article.meta.excerpt,
        tags: devtoTags(article)
      }
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      status: "failed",
      platform: "devto",
      title: article.meta.title,
      code: response.status,
      error: text.slice(0, 1000)
    };
  }

  const body = safeJson(text);
  return {
    status: published ? "api-published" : "api-draft-created",
    platform: "devto",
    title: article.meta.title,
    code: response.status,
    draftUrl: body?.url || body?.canonical_url || "",
    id: body?.id || ""
  };
}

async function prepareDevtoBody(article, body) {
  return replaceImageMarkdown(body, article, (sourceUrl) => imageProxyUrl(sourceUrl, "jpg"));
}

function replaceImageMarkdown(body, article, transformUrl) {
  const imageMatches = [...body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/gi)];
  let nextBody = body;
  for (const match of imageMatches) {
    const [fullMatch, alt, imagePath] = match;
    const sourceUrl = resolveArticleImageUrl(article, imagePath);
    if (!sourceUrl) continue;
    nextBody = nextBody.replace(fullMatch, `![${alt}](${transformUrl(sourceUrl)})`);
  }
  return nextBody;
}

function resolveArticleImageUrl(article, imagePath) {
  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  const normalizedPath = normalizePath(join(article.dir, imagePath));
  const matched = (article.meta.images || []).find((image) => normalizePath(image.localPath || "") === normalizedPath || basename(image.localPath || "") === basename(imagePath));
  return matched?.url || null;
}

function imageProxyUrl(sourceUrl, output) {
  const url = new URL(sourceUrl);
  const remotePath = `${url.hostname}${url.pathname}`;
  return `https://wsrv.nl/?url=${encodeURIComponent(remotePath)}&output=${output}`;
}

function removeEmptyValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry === undefined || entry === null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}


async function check() {
  const slugs = await listArticleSlugs();
  const issues = [];
  for (const slug of slugs) {
    const dir = join(ARTICLES_DIR, slug);
    for (const file of ["article.md", "meta.json"]) {
      try {
        await stat(join(dir, file));
      } catch {
        issues.push(`${slug} missing ${file}`);
      }
    }
    for (const platform of PLATFORMS) {
      try {
        await stat(join(dir, "platforms", `${platform}.md`));
      } catch {
        issues.push(`${slug} missing platforms/${platform}.md`);
      }
    }
  }
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Check passed for ${slugs.length} article(s).`);
  }
}

async function listArticleSlugs() {
  try {
    const entries = await readdir(ARTICLES_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function loadArticle(slug) {
  const dir = join(ARTICLES_DIR, slug);
  return {
    dir,
    markdown: await readFile(join(dir, "article.md"), "utf8"),
    meta: JSON.parse(await readFile(join(dir, "meta.json"), "utf8"))
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.slice(2).split("=");
    options[rawKey] = rawValue ?? args[index + 1] ?? true;
    if (rawValue === undefined && args[index + 1] && !args[index + 1].startsWith("--")) index += 1;
  }
  return options;
}

function parseStartDate(value) {
  if (value === "now") return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid start date: ${value}`);
  return date;
}

function htmlToMarkdown(html, articleDir) {
  let out = html;
  out = out.replace(/\r/g, "");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, "\n_$1_\n");
  out = out.replace(/<figure[^>]*>/gi, "\n\n").replace(/<\/figure>/gi, "\n\n");
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${"#".repeat(Number(level))} ${inline(text)}\n\n`);
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n\n> ${inline(text).replace(/\n/g, "\n> ")}\n\n`);
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${inline(text).trim()}`);
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = absolutize(attr(tag, "src") || attr(tag, "data-src") || "");
    const alt = decodeHtml(attr(tag, "alt") || "");
    const local = imageMarkdownPath(src, articleDir);
    return local ? `\n\n![${escapeMd(alt)}](${local})\n\n` : "";
  });
  out = out.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const label = inline(text);
    return label ? `[${label}](${absolutize(decodeHtml(href))})` : "";
  });
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => `**${inline(text)}**`);
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => `_${inline(text)}_`);
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n").replace(/<p[^>]*>/gi, "");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeHtml(out);
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function cleanSyndicationMarkdown(markdown) {
  return String(markdown)
    .replace(/^\s*\.[^{\n]+?\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*$/gm, "")
    .replace(/^\s*(?:\.wp-block-|\.kb-|\.kt-|\.has-|\.is-|\.align)[\s\S]*?(?=\n#{1,6}\s|\n[A-Z][^\n]{2,120}\n|\n> |\n---|\n\n\n|$)/gm, "")
    .replace(/\[\]\([^)]+\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inline(html) {
  return decodeHtml(String(html).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function imageMarkdownPath(src, articleDir) {
  if (!src) return "";
  const name = slugify(basename(new URL(src).pathname).replace(extname(new URL(src).pathname), ""));
  const extension = extname(new URL(src).pathname) || ".img";
  if (basename(articleDir) && src.includes(name)) return `images/${name}${extension}`;
  return src;
}

function frontMatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlString(item)}`);
    } else {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function stripExistingCanonical(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/\n?---\n\nCanonical source:[\s\S]*$/m, "")
    .trim();
}

function canonicalLink(article) {
  return `\n\n---\n\nOriginally published by Rightjob Solutions: [${article.meta.title}](${article.meta.originalUrl})`;
}

function cleanExcerpt(html) {
  return decodeHtml(stripTags(html)).replace(/\s+/g, " ").trim();
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, " ");
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function absolutize(url) {
  return new URL(url, SITE).toString();
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function escapeMd(value) {
  return String(value).replace(/]/g, "\\]");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "untitled";
}

function devtoTags(article) {
  const tags = article.meta.tags
    .map((tag) => String(tag).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 4);
}

function normalizePath(file) {
  return file.replaceAll("\\", "/");
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

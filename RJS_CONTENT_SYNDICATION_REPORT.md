# RightJob Solutions Content Syndication Report

Generated: 2026-07-01

## Overview

This project automates the RightJob Solutions content syndication workflow. It pulls newer articles from the RightJob Solutions Newsroom, converts them into reusable Markdown drafts, prepares platform-specific versions, and now includes a local web UI focused on DEV.to publishing.

Source:

```text
https://rightjobsolutions.com/newsroom/
```

Current article filter:

```text
Only articles published from April 1, 2026 onward
```

## Core Capabilities

### 1. Pull Latest Articles

The system retrieves published newsroom articles through the RightJob Solutions WordPress REST API.

Command:

```powershell
npm run all
```

This pulls articles, downloads article assets, converts body content to Markdown, and regenerates platform drafts.

Current verified archive:

```text
49 articles
```

### 2. Local Article Archive

Each article is saved locally under:

```text
data/articles/<article-slug>/
```

Each article folder contains:

```text
article.md
meta.json
featured-image.webp
images/
platforms/
```

`meta.json` stores structured article data:

- title
- slug
- publication date
- excerpt
- original URL
- categories
- tags
- featured image
- body images
- source API URL

### 3. Platform Draft Exports

The system generates platform-ready Markdown files for:

- DEV.to
- Medium
- Tumblr
- Hashnode
- Forem

Generated files:

```text
platforms/devto.md
platforms/medium.md
platforms/tumblr.md
platforms/hashnode.md
platforms/forem.md
```

Each draft includes a canonical/original source link back to the RightJob Solutions article.

### 4. DEV.to API Draft Creation

DEV.to is currently the main supported API platform.

The system can create DEV.to drafts using the official DEV.to API.

Important behavior:

- Creates drafts only
- Does not publish automatically
- Uses `published: false`
- Adds the canonical RightJob source URL
- Uses DEV.to-safe tags
- Uses public JPG-compatible image URLs for DEV.to rendering

Command:

```powershell
npm run queue -- --platform devto --action draft --limit 1 --interval-days 1 --start now
npm run schedule
```

### 5. DEV.to Image Handling

RightJob newsroom images are mostly WebP.

DEV.to had rendering issues with local or WebP image paths, so the DEV.to draft export now rewrites image references into public JPEG-serving URLs.

Example:

```markdown
![image](https://wsrv.nl/?url=rightjobsolutions.com%2Fwp-content%2Fuploads%2F...webp&output=jpg)
```

This allows DEV.to to fetch a public image as JPEG.

### 6. Posting Queue and Scheduler

The project includes a simple posting calendar:

```text
posting-calendar.json
```

Supported queue actions:

- `manual` - prepare a file for manual posting
- `draft` - create an API draft where supported, currently DEV.to

Run due scheduled items:

```powershell
npm run schedule
```

Scheduler state is stored in:

```text
data/scheduler-state.json
```

This prevents already-completed scheduled entries from running repeatedly.

### 7. Local Web UI

A local dashboard was added for easier operation.

Start the UI:

```powershell
npm run ui
```

Open:

```text
http://localhost:3077
```

The UI can:

- show current archive status
- show whether the DEV.to API key is configured
- list pulled articles
- search articles
- pull latest articles
- regenerate drafts
- run the scheduler
- create a DEV.to draft for a selected article
- display recent job logs

### 8. Browser Drafting Agent

A separate Python Playwright-based browser drafting agent exists under:

```text
guestpost_agent/
```

It was built for future browser-assisted drafting workflows.

It can:

- use a persistent Chrome profile
- reuse existing login sessions
- pause for login, CAPTCHA, or 2FA
- prepare draft content
- generate reports
- avoid duplicate draft attempts through SQLite

Current focus remains DEV.to API drafting through the Node workflow and UI.

## Safety and Publishing Rules

The system is intentionally draft-first.

It does not:

- auto-publish to DEV.to
- bypass login, CAPTCHA, or 2FA
- hardcode API keys in source code
- post to unsupported platforms through unofficial APIs

API credentials are stored locally in:

```text
.env
```

The `.env` file is ignored by git.

## Current Commands

```powershell
npm run all
npm run pull
npm run export
npm run queue
npm run schedule
npm run draft
npm run check
npm run ui
```

Most useful daily commands:

```powershell
npm run ui
```

or:

```powershell
npm run all
npm run queue -- --platform devto --action draft --limit 1 --interval-days 1 --start now
npm run schedule
```

## Current Status

Verified working:

- article pulling
- Markdown conversion
- platform draft generation
- DEV.to API draft creation
- DEV.to tag normalization
- DEV.to image URL fix
- scheduler
- local UI server

Last validation:

```text
Check passed for 49 article(s).
```

## Recommended Next Steps

1. Continue using DEV.to as the first production platform.
2. Add draft history to the UI so created DEV.to draft URLs are easier to revisit.
3. Add per-article status badges for drafted/skipped/failed.
4. Add manual workflow support for Medium, Tumblr, Hashnode, and Forem.
5. Add a preview panel inside the UI for `devto.md`.
6. Later, add official API support for other platforms only when credentials and platform rules are confirmed.

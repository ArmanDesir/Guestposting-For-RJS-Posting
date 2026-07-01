# RightJob Solutions Content Syndication

This automation pulls newer published articles from the Rightjob Solutions newsroom, saves a local archive, generates platform-ready manual drafts, and checks a posting calendar for syndication work.

## What It Creates

Each article is stored under `data/articles/<slug>/` with:

- `article.md`
- `meta.json`
- `featured-image.<ext>` when available
- `images/` for body images
- `platforms/medium.md`
- `platforms/tumblr.md`
- `platforms/devto.md`
- `platforms/hashnode.md`
- `platforms/forem.md`

All platform versions include a canonical source link back to the original Rightjob Solutions article.

## Commands

```powershell
npm run pull
npm run export
npm run queue
npm run all
npm run schedule
npm run check
```

`npm run all` pulls posts, downloads images, creates Markdown, and writes platform exports.

`npm run queue` creates a manual posting queue in `posting-calendar.json`.

`npm run schedule` reads `posting-calendar.json`, finds due entries, and marks the matching platform draft file as ready for manual posting. For DEV.to only, `action: "draft"` creates an official API draft when `DEVTO_API_KEY` exists in `.env`.

It never publishes automatically.

## Scheduler

Create a DEV.to manual queue for the five newest articles:

```powershell
npm run queue -- --platform devto --limit 5 --interval-days 1 --start 2026-07-02T09:00:00+08:00
```

Create a DEV.to API-draft queue:

```powershell
npm run queue -- --platform devto --action draft --limit 5 --interval-days 1 --start 2026-07-02T09:00:00+08:00
```

Or add entries manually:

```json
[
  {
    "date": "2026-07-02T09:00:00+08:00",
    "slug": "your-article-slug",
    "platform": "devto",
    "action": "draft"
  }
]
```

Supported platforms:

- `medium`
- `tumblr`
- `devto`
- `hashnode`
- `forem`

Use `action: "draft"` for DEV.to when the API key is configured. Use `action: "manual"` for every other platform; the scheduler will output the exact file to copy into the platform editor.

DEV.to API drafts need public image URLs. During export, WebP images referenced in DEV.to drafts are rewritten through a public JPG conversion URL so DEV.to receives a fetchable JPEG image instead of a local file path.

## Notes

- Source: `https://rightjobsolutions.com/newsroom/`
- Data source: WordPress REST API at `https://rightjobsolutions.com/wp-json/wp/v2/posts`
- Current standard: only articles published from `2026-04-01T00:00:00` onward are pulled.
- The default scheduler state is saved in `data/scheduler-state.json`.

## Browser Drafting Agent

The Python agent in `guestpost_agent/` is a Playwright-based browser workflow for draft-only guest posting. It does not use platform APIs or access tokens.

It:

- checks RightJob Solutions newsroom posts from `2026-04-15T00:00:00` onward
- stores duplicate-prevention state in SQLite
- opens publishing platforms in a persistent Chrome profile
- reuses existing login sessions
- pauses for human login, CAPTCHA, or 2FA
- prepares drafts only
- writes a Markdown report after every run
- adds review-only guest posting discovery search links

Install browser automation dependencies:

```powershell
C:\Users\Admin-PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m pip install -r requirements.txt
C:\Users\Admin-PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m playwright install chrome
```

Create a report without opening browser drafts:

```powershell
C:\Users\Admin-PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m guestpost_agent --limit 1 --discover
```

Create one DEV.to browser-assisted draft:

```powershell
C:\Users\Admin-PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m guestpost_agent --draft --platform devto --limit 1
```

Use the RightJob support Chrome profile by setting `.env`:

```env
RJS_BROWSER_PROFILE=C:\Users\Admin-PC\AppData\Local\Google\Chrome\User Data
RJS_CHROME_PROFILE_NAME=Profile 1
```

On this machine, Chrome `Profile 1` is `support@rightjobsolutions.com`. Close existing Chrome windows before running Playwright against that profile, because Chrome may lock an active profile.

For browser drafting, the agent will open Chrome. If the account is not logged in, log in manually. If CAPTCHA or 2FA appears, complete it manually, then resume. The agent never clicks publish.

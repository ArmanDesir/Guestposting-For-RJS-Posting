# RightJob Solutions Content Syndication

This automation pulls published articles from the Rightjob Solutions newsroom, saves a local archive, generates platform-ready drafts, and checks a posting calendar for scheduled syndication.

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
npm run all
npm run schedule
npm run check
```

`npm run all` pulls posts, downloads images, creates Markdown, and writes platform exports.

`npm run schedule` reads `posting-calendar.json`, finds due entries, and either:

- creates/updates local manual export files, or
- creates API drafts only when an official API token is present in environment variables.

It never auto-posts without official API access.

## Scheduler

Copy `posting-calendar.example.json` to `posting-calendar.json` and add entries:

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

Use `action: "manual"` for platforms that should only export files for manual posting. Use `action: "draft"` to create a platform draft through an official API where supported and configured.

## Environment Variables

API keys are read only from environment variables. See `.env.example`.

Do not put credentials in source files, `meta.json`, platform drafts, or the posting calendar.

## Notes

- Source: `https://rightjobsolutions.com/newsroom/`
- Data source: WordPress REST API at `https://rightjobsolutions.com/wp-json/wp/v2/posts`
- The default scheduler state is saved in `data/scheduler-state.json`.

from __future__ import annotations

import argparse
import asyncio

from guestpost_agent.browser.session import browser_context
from guestpost_agent.config import load_settings
from guestpost_agent.discovery.search import build_guest_post_search_plan
from guestpost_agent.publishers.registry import get_publishers
from guestpost_agent.reports.report import write_report
from guestpost_agent.scraper.rightjob import fetch_articles
from guestpost_agent.storage.db import Store


def main() -> int:
    parser = argparse.ArgumentParser(description="RightJob Solutions browser drafting agent")
    parser.add_argument("--draft", action="store_true", help="Open browser and create platform drafts")
    parser.add_argument("--limit", type=int, default=1, help="Maximum new articles to process")
    parser.add_argument("--platform", action="append", help="Limit to one or more platforms, e.g. --platform devto")
    parser.add_argument("--discover", action="store_true", help="Include guest-post discovery search plan in the report")
    parser.add_argument("--force", action="store_true", help="Retry even if this article/platform is already recorded")
    args = parser.parse_args()
    return asyncio.run(run(args))


async def run(args) -> int:
    settings = load_settings()
    store = Store(settings.database_path)
    articles = fetch_articles(settings.min_published_date)
    publishers = get_publishers()
    if args.platform:
        wanted = set(args.platform)
        publishers = [publisher for publisher in publishers if publisher.platform in wanted]

    skipped = [article for article in articles if store.seen_article(article)]
    selected = []
    if args.draft:
        for article in articles:
            if args.force or any(not store.drafted(article, publisher.platform) for publisher in publishers):
                selected.append(article)
            if len(selected) >= args.limit:
                break
    results = []

    if args.draft and selected:
        async with browser_context(settings) as context:
            for article in selected:
                store.upsert_article(article)
                for publisher in publishers:
                    if not args.force and store.drafted(article, publisher.platform):
                        continue
                    result = await publisher.create_draft(context, article)
                    store.record_draft(result)
                    results.append(result)

    opportunities = build_guest_post_search_plan() if args.discover else []
    report_path = write_report(settings.report_dir, articles, selected, skipped, results, opportunities)
    print(f"Found {len(articles)} article(s), processed {len(selected)}, skipped {len(skipped)} duplicate(s).")
    print(f"Report: {report_path}")
    return 0

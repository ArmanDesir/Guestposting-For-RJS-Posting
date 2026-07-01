from __future__ import annotations

import sqlite3
from pathlib import Path

from guestpost_agent.models import Article, DraftResult


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.migrate()

    def migrate(self) -> None:
        self.connection.executescript(
            """
            create table if not exists articles (
              url text primary key,
              title text not null,
              published_at text,
              processed_at text default current_timestamp,
              last_modified text
            );
            create table if not exists drafts (
              article_url text not null,
              platform text not null,
              status text not null,
              draft_url text,
              message text,
              error text,
              updated_at text default current_timestamp,
              primary key(article_url, platform)
            );
            """
        )
        self.connection.commit()

    def seen_article(self, article: Article) -> bool:
        row = self.connection.execute("select 1 from articles where url = ?", (article.url,)).fetchone()
        return row is not None

    def upsert_article(self, article: Article) -> None:
        self.connection.execute(
            """
            insert into articles(url, title, published_at, last_modified)
            values (?, ?, ?, ?)
            on conflict(url) do update set title = excluded.title, published_at = excluded.published_at
            """,
            (article.url, article.title, article.published_at, article.published_at),
        )
        self.connection.commit()

    def drafted(self, article: Article, platform: str) -> bool:
        row = self.connection.execute(
            "select 1 from drafts where article_url = ? and platform = ? and status in ('draft_created', 'manual_ready')",
            (article.url, platform),
        ).fetchone()
        return row is not None

    def record_draft(self, result: DraftResult) -> None:
        self.connection.execute(
            """
            insert into drafts(article_url, platform, status, draft_url, message, error, updated_at)
            values (?, ?, ?, ?, ?, ?, current_timestamp)
            on conflict(article_url, platform) do update set
              status = excluded.status,
              draft_url = excluded.draft_url,
              message = excluded.message,
              error = excluded.error,
              updated_at = current_timestamp
            """,
            (result.article_url, result.platform, result.status, result.draft_url, result.message, result.error),
        )
        self.connection.commit()

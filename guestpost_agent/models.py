from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Article:
    title: str
    url: str
    slug: str
    published_at: str
    author: str = ""
    subtitle: str = ""
    excerpt: str = ""
    content_html: str = ""
    content_markdown: str = ""
    featured_image_url: str = ""
    categories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    links: list[dict[str, str]] = field(default_factory=list)


@dataclass(slots=True)
class DraftResult:
    platform: str
    status: str
    article_url: str
    message: str = ""
    draft_url: str = ""
    error: str = ""

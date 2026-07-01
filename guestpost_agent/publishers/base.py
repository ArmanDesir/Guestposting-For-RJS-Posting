from __future__ import annotations

from abc import ABC, abstractmethod

from guestpost_agent.models import Article, DraftResult


class Publisher(ABC):
    platform: str

    @abstractmethod
    async def create_draft(self, context, article: Article) -> DraftResult:
        raise NotImplementedError


def draft_markdown(article: Article) -> str:
    tags = article.tags[:5]
    tag_line = ", ".join(tags)
    canonical = f"\n\n---\n\nOriginally published by RightJob Solutions: [{article.title}]({article.url})"
    return "\n".join([
        f"# {article.title}",
        "",
        article.subtitle or article.excerpt,
        "",
        article.content_markdown,
        canonical,
        "",
        f"Tags: {tag_line}" if tag_line else "",
    ]).strip()

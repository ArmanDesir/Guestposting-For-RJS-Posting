from __future__ import annotations

import json
import urllib.parse
import urllib.request

from guestpost_agent.models import Article
from guestpost_agent.parser.html import clean_text, extract_headings, extract_images, extract_links, html_to_markdown

SITE = "https://rightjobsolutions.com"
POSTS_API = f"{SITE}/wp-json/wp/v2/posts"
CATEGORIES_API = f"{SITE}/wp-json/wp/v2/categories"
TAGS_API = f"{SITE}/wp-json/wp/v2/tags"
USER_AGENT = "RightJobSolutions-GuestPostAgent/1.0 (+https://rightjobsolutions.com)"


def fetch_articles(min_published_date: str) -> list[Article]:
    categories = fetch_terms(CATEGORIES_API)
    tags = fetch_terms(TAGS_API)
    posts = fetch_posts(min_published_date)
    articles = [post_to_article(post, categories, tags) for post in posts]
    return sorted(articles, key=lambda article: article.published_at, reverse=True)


def fetch_posts(min_published_date: str) -> list[dict]:
    posts: list[dict] = []
    page = 1
    while True:
        params = urllib.parse.urlencode({
            "status": "publish",
            "after": min_published_date,
            "per_page": "100",
            "page": str(page),
            "_embed": "1",
        })
        data, headers = fetch_json(f"{POSTS_API}?{params}")
        posts.extend(data)
        total_pages = int(headers.get("x-wp-totalpages", page))
        if page >= total_pages or not data:
            break
        page += 1
    return posts


def fetch_terms(endpoint: str) -> dict[int, str]:
    terms: dict[int, str] = {}
    page = 1
    while True:
        data, headers = fetch_json(f"{endpoint}?per_page=100&page={page}")
        for term in data:
            terms[int(term["id"])] = term["name"]
        total_pages = int(headers.get("x-wp-totalpages", page))
        if page >= total_pages or not data:
            break
        page += 1
    return terms


def fetch_json(url: str) -> tuple[dict | list, dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        body = response.read().decode("utf-8")
        headers = {key.lower(): value for key, value in response.headers.items()}
    return json.loads(body), headers


def post_to_article(post: dict, categories: dict[int, str], tags: dict[int, str]) -> Article:
    content_html = post.get("content", {}).get("rendered", "")
    title = clean_text(post.get("title", {}).get("rendered", ""))
    media = (post.get("_embedded", {}).get("wp:featuredmedia") or [{}])[0]
    featured = media.get("source_url") or post.get("yoast_head_json", {}).get("og_image", [{}])[0].get("url", "")
    article = Article(
        title=title,
        url=post.get("link") or post.get("yoast_head_json", {}).get("canonical", ""),
        slug=post.get("slug", ""),
        published_at=post.get("date_gmt") or post.get("date", ""),
        author=(post.get("yoast_head_json", {}) or {}).get("author", ""),
        subtitle=clean_text((post.get("yoast_head_json", {}) or {}).get("description", "")),
        excerpt=clean_text(post.get("excerpt", {}).get("rendered", "")),
        content_html=content_html,
        content_markdown=html_to_markdown(content_html),
        featured_image_url=featured,
        categories=[categories[item] for item in post.get("categories", []) if item in categories],
        tags=[tags[item] for item in post.get("tags", []) if item in tags],
        images=extract_images(content_html),
        headings=extract_headings(content_html),
        links=extract_links(content_html),
    )
    if featured and featured not in article.images:
        article.images.insert(0, featured)
    return article

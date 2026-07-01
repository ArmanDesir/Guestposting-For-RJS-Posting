from __future__ import annotations

import html
import re


def strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "").strip()


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(strip_tags(value))).strip()


def attr(tag: str, name: str) -> str:
    match = re.search(rf'{name}=["\']([^"\']*)["\']', tag, flags=re.I)
    return html.unescape(match.group(1)) if match else ""


def extract_images(content_html: str) -> list[str]:
    images: list[str] = []
    for match in re.finditer(r"<img\b[^>]*>", content_html or "", flags=re.I):
        src = attr(match.group(0), "src") or attr(match.group(0), "data-src")
        if src and src not in images:
            images.append(src)
    return images


def extract_headings(content_html: str) -> list[str]:
    return [
        clean_text(match.group(2))
        for match in re.finditer(r"<h([1-6])[^>]*>(.*?)</h\1>", content_html or "", flags=re.I | re.S)
    ]


def extract_links(content_html: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for match in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", content_html or "", flags=re.I | re.S):
        links.append({"url": html.unescape(match.group(1)), "text": clean_text(match.group(2))})
    return links


def html_to_markdown(content_html: str) -> str:
    text = content_html or ""
    text = re.sub(r"\r", "", text)
    text = re.sub(r"<figcaption[^>]*>(.*?)</figcaption>", lambda m: f"\n_{clean_text(m.group(1))}_\n", text, flags=re.I | re.S)
    text = re.sub(r"</?figure[^>]*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<h([1-6])[^>]*>(.*?)</h\1>", lambda m: f"\n\n{'#' * int(m.group(1))} {clean_text(m.group(2))}\n\n", text, flags=re.I | re.S)
    text = re.sub(r"<blockquote[^>]*>(.*?)</blockquote>", lambda m: "\n\n> " + clean_text(m.group(1)) + "\n\n", text, flags=re.I | re.S)
    text = re.sub(r"<li[^>]*>(.*?)</li>", lambda m: "\n- " + clean_text(m.group(1)), text, flags=re.I | re.S)
    text = re.sub(r"</?(ul|ol)[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<img\b[^>]*>", lambda m: image_md(m.group(0)), text, flags=re.I)
    text = re.sub(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", lambda m: f"[{clean_text(m.group(2))}]({html.unescape(m.group(1))})", text, flags=re.I | re.S)
    text = re.sub(r"<(strong|b)[^>]*>(.*?)</\1>", lambda m: f"**{clean_text(m.group(2))}**", text, flags=re.I | re.S)
    text = re.sub(r"<(em|i)[^>]*>(.*?)</\1>", lambda m: f"_{clean_text(m.group(2))}_", text, flags=re.I | re.S)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"<p[^>]*>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def image_md(tag: str) -> str:
    src = attr(tag, "src") or attr(tag, "data-src")
    alt = attr(tag, "alt")
    return f"\n\n![{alt}]({src})\n\n" if src else ""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class Settings:
    browser_profile: Path
    upload_dir: Path
    report_dir: Path
    database_path: Path
    min_published_date: str
    default_tags: list[str]
    default_categories: list[str]
    headless: bool
    slow_mo_ms: int


def load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def csv_env(name: str, fallback: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, fallback).split(",") if item.strip()]


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        browser_profile=Path(os.getenv("RJS_BROWSER_PROFILE", ".browser-profile")),
        upload_dir=Path(os.getenv("RJS_UPLOAD_DIR", "data/articles")),
        report_dir=Path(os.getenv("RJS_REPORT_DIR", "reports")),
        database_path=Path(os.getenv("RJS_DATABASE_PATH", "data/guestpost-agent.sqlite")),
        min_published_date=os.getenv("RJS_MIN_PUBLISHED_DATE", "2026-04-15T00:00:00"),
        default_tags=csv_env("RJS_DEFAULT_TAGS", "digital-marketing,seo,business"),
        default_categories=csv_env("RJS_DEFAULT_CATEGORIES", "Digital Marketing"),
        headless=os.getenv("RJS_HEADLESS", "false").lower() == "true",
        slow_mo_ms=int(os.getenv("RJS_SLOW_MO_MS", "150")),
    )

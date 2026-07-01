from __future__ import annotations

from contextlib import asynccontextmanager

from guestpost_agent.config import Settings


@asynccontextmanager
async def browser_context(settings: Settings):
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is not installed. Run: pip install -r requirements.txt && playwright install chrome") from exc

    settings.browser_profile.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(settings.browser_profile),
            channel="chrome",
            headless=settings.headless,
            slow_mo=settings.slow_mo_ms,
            viewport={"width": 1440, "height": 1100},
        )
        try:
            yield context
        finally:
            await context.close()


async def pause_for_human(page, reason: str) -> None:
    print(f"\nACTION NEEDED: {reason}")
    print("Complete login, CAPTCHA, or 2FA in the browser window. Then press Enter here to continue.")
    await page.pause()

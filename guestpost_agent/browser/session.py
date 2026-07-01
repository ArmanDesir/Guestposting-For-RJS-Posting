from __future__ import annotations

import asyncio
import subprocess
from contextlib import asynccontextmanager

from guestpost_agent.config import Settings


@asynccontextmanager
async def browser_context(settings: Settings):
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is not installed. Run: pip install -r requirements.txt && playwright install chrome") from exc

    async with async_playwright() as playwright:
        if settings.cdp_url:
            browser = await playwright.chromium.connect_over_cdp(settings.cdp_url)
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            try:
                yield context
            finally:
                # Do not close the company Chrome instance; leaving the async
                # Playwright block only disconnects this agent from the session.
                pass
            return

        settings.browser_profile.mkdir(parents=True, exist_ok=True)
        profile_name = (settings.chrome_profile_name or "Default").strip() or "Default"
        if is_real_chrome_profile(settings) and chrome_is_running():
            raise RuntimeError(
                "Chrome is already running while the company profile is selected. "
                "Close all Chrome windows and background Chrome processes, then try Medium again. "
                "Or start company Chrome with --remote-debugging-port=9222 and set RJS_CDP_URL=http://localhost:9222."
            )
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(settings.browser_profile),
            channel="chrome",
            headless=settings.headless,
            slow_mo=settings.slow_mo_ms,
            viewport={"width": 1440, "height": 1100},
            args=[f"--profile-directory={profile_name}"],
        )
        try:
            yield context
        finally:
            await context.close()


async def pause_for_human(page, reason: str) -> None:
    print(f"\nACTION NEEDED: {reason}")
    print("Complete login, CAPTCHA, or 2FA in the browser window. Then press Enter here to continue.")
    await page.bring_to_front()
    await asyncio.to_thread(input, "Press Enter to continue...")


def is_real_chrome_profile(settings: Settings) -> bool:
    return "Google\\Chrome\\User Data" in str(settings.browser_profile)


def chrome_is_running() -> bool:
    try:
        output = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq chrome.exe"], text=True, stderr=subprocess.DEVNULL)
        return "chrome.exe" in output.lower()
    except Exception:
        return False

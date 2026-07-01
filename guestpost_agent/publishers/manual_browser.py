from __future__ import annotations

from guestpost_agent.browser.session import pause_for_human
from guestpost_agent.models import Article, DraftResult
from guestpost_agent.publishers.base import Publisher, draft_markdown


class ManualBrowserPublisher(Publisher):
    """Best-effort browser draft creator.

    The class opens the platform editor, waits for login when needed, and copies the
    draft content into the clipboard. For editors with unstable UI selectors, the
    operator can paste manually while the browser session remains open.
    """

    def __init__(self, platform: str, editor_url: str, title_selectors: list[str] | None = None, body_selectors: list[str] | None = None):
        self.platform = platform
        self.editor_url = editor_url
        self.title_selectors = title_selectors or []
        self.body_selectors = body_selectors or []

    async def create_draft(self, context, article: Article) -> DraftResult:
        page = await context.new_page()
        try:
            await page.goto(self.editor_url, wait_until="domcontentloaded", timeout=60000)
            if await login_or_verification_visible(page):
                await pause_for_human(page, f"{self.platform} needs login or verification.")

            markdown = draft_markdown(article)
            await page.evaluate("text => navigator.clipboard.writeText(text)", markdown)
            title_done = await fill_first(page, self.title_selectors, article.title)
            body_done = await fill_first(page, self.body_selectors, markdown)

            if not body_done:
                await pause_for_human(
                    page,
                    f"{self.platform} editor is open and the draft is copied to clipboard. Paste it, save as draft, then continue.",
                )
                return DraftResult(self.platform, "manual_ready", article.url, "Draft copied to clipboard for manual paste.", page.url)

            return DraftResult(
                self.platform,
                "draft_created",
                article.url,
                "Draft content filled. Review platform editor and save/publish manually.",
                page.url,
            )
        except Exception as exc:
            return DraftResult(self.platform, "failed", article.url, error=str(exc))


async def fill_first(page, selectors: list[str], value: str) -> bool:
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if await locator.count() == 0:
                continue
            await locator.fill(value, timeout=3000)
            return True
        except Exception:
            try:
                await locator.click(timeout=3000)
                await page.keyboard.insert_text(value)
                return True
            except Exception:
                continue
    return False


async def login_or_verification_visible(page) -> bool:
    patterns = ["log in", "sign in", "captcha", "verification", "two-factor", "2fa", "verify"]
    body = (await page.locator("body").inner_text(timeout=5000)).lower()
    return any(pattern in body for pattern in patterns)

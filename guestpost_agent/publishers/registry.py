from __future__ import annotations

from guestpost_agent.publishers.manual_browser import ManualBrowserPublisher


def get_publishers() -> list[ManualBrowserPublisher]:
    return [
        ManualBrowserPublisher("devto", "https://dev.to/new", ["input[name='title']"], ["textarea"]),
        ManualBrowserPublisher("medium", "https://medium.com/new-story", ["textarea[placeholder*='Title']"], ["div[contenteditable='true']"]),
        ManualBrowserPublisher("tumblr", "https://www.tumblr.com/new/text", ["textarea", "input"], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("hashnode", "https://hashnode.com/draft", ["textarea", "input"], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("forem", "https://forem.com/new", ["input[name='title']"], ["textarea"]),
        ManualBrowserPublisher("substack", "https://substack.com/home", [], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("quora", "https://rightjobsupportsspace.quora.com/", [], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("hubspot", "https://blog.hubspot.com/", [], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("hackernoon", "https://app.hackernoon.com/new", ["textarea", "input"], ["div[contenteditable='true']", "textarea"]),
        ManualBrowserPublisher("wakelet", "https://wakelet.com/", [], ["div[contenteditable='true']", "textarea"]),
    ]

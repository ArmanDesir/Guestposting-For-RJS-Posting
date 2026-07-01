from __future__ import annotations


TOPICS = [
    "SEO",
    "AI",
    "Generative Engine Optimization",
    "Digital Marketing",
    "Local SEO",
    "Business",
    "Recruitment",
    "HR",
    "Staffing",
    "Outsourcing",
    "Technology",
    "Remote Work",
]


def build_guest_post_search_plan() -> list[dict[str, str]]:
    """Create a review-only discovery plan.

    The agent does not submit guest posts automatically. These search URLs are
    included in reports/exports so a human can validate reputation, guidelines,
    and submission method before outreach.
    """

    opportunities: list[dict[str, str]] = []
    for topic in TOPICS:
        query = f'{topic} "write for us" OR "guest post guidelines"'
        opportunities.append({
            "name": f"{topic} guest post search",
            "url": f"https://www.google.com/search?q={query.replace(' ', '+')}",
            "guidelines": "Human review required",
            "email": "",
            "domain_authority": "",
            "method": "research only",
        })
    return opportunities

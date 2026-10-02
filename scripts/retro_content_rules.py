#!/usr/bin/env python3
"""
Retro Arcade content rules for the catalog generators.

The rules are in apps/web/src/games/retro-arcade/lib/content-rules.json.
The web app (content-rules.ts: the catalog test and the ROM proxy) reads the
same file. Keep normalize(), without_dump_tags() and candidate_texts() the
same as normalizeTitle(), withoutDumpTags() and candidateTexts() in
content-match.ts.

Each rule has an action (Jack, 2026-10-02):
- "block": sexual content. The upload scripts call blocked_rule() before
  they upload a ROM. A blocked ROM is not uploaded and does not go into the
  catalog.
- "notice": a mainstream violent classic. The ROM is uploaded and listed
  like every other game. The arcade shows a heads-up card when a player
  opens it. The generators do not refuse a notice rule.
When a title matches a block rule and a notice rule, the block rule applies.

Run this file to check the rules against their examples, the safe titles,
and the reference catalogs in this folder:

    python3 scripts/retro_content_rules.py
"""

import json
import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
RULES_PATH = (
    SCRIPTS_DIR.parent
    / "apps" / "web" / "src" / "games" / "retro-arcade" / "lib" / "content-rules.json"
)
ACTIONS = ("block", "notice")


def load_rules(path: Path = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for rule in data["rules"]:
        # An unknown action is an error, never a silent allow.
        if rule.get("action") not in ACTIONS:
            raise ValueError(f"content rule {rule.get('id')!r} has an unknown action {rule.get('action')!r}")
        rule["regex"] = re.compile(rule["pattern"], re.IGNORECASE)
    return data


_RULES_DATA = load_rules()
RULES = _RULES_DATA["rules"]
SAFE_TITLES = _RULES_DATA["safeTitles"]


def normalize(text: str) -> str:
    """Lowercase, change '_' and '-' to spaces, and collapse the spaces."""
    text = re.sub(r"[_-]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def without_extension(filename: str) -> str:
    return re.sub(r"\.[a-z0-9]+$", "", filename, flags=re.IGNORECASE)


def without_dump_tags(text: str) -> str:
    """Remove the tags at the end of a ROM dump name: from the first '(' or '[' to the end."""
    return re.sub(r"\s*[(\[].*$", "", text)


def candidate_texts(display_name: str, filename: str = "", game_id: str = "") -> list:
    """The texts a rule reads, each normalized as it is and again with no dump tags."""
    texts = []
    for text in (display_name, without_extension(filename), game_id):
        if not text:
            continue
        for candidate in (normalize(text), normalize(without_dump_tags(text))):
            if candidate and candidate not in texts:
                texts.append(candidate)
    return texts


def content_rule(display_name: str, filename: str = "", game_id: str = ""):
    """Return the rule that applies to this title (block before notice), or None."""
    texts = candidate_texts(display_name, filename, game_id)
    notice = None
    for rule in RULES:
        if not any(rule["regex"].search(text) for text in texts):
            continue
        if rule["action"] == "block":
            return rule
        if notice is None:
            notice = rule
    return notice


def blocked_rule(display_name: str, filename: str = "", game_id: str = ""):
    """Return the block rule of this title, or None. A notice title is not blocked."""
    rule = content_rule(display_name, filename, game_id)
    return rule if rule and rule["action"] == "block" else None


def _self_check() -> int:
    problems = []
    for rule in RULES:
        if rule["category"] == "sexual" and rule["action"] != "block":
            problems.append(f"rule {rule['id']} is sexual content but its action is {rule['action']!r}")
        for example in rule["examples"]:
            if not rule["regex"].search(normalize(example)):
                problems.append(f"rule {rule['id']} does not match its example {example!r}")
    for title in SAFE_TITLES:
        rule = content_rule(title)
        if rule:
            problems.append(f"safe title {title!r} is matched by rule {rule['id']}")
    notice_titles = 0
    for catalog_file in sorted(SCRIPTS_DIR.glob("*_catalog.json")):
        with open(catalog_file, encoding="utf-8") as f:
            for game in json.load(f):
                rule = content_rule(game["displayName"], game["filename"], game["id"])
                if rule and rule["action"] == "block":
                    problems.append(
                        f"{catalog_file.name}: {game['displayName']} is blocked by rule {rule['id']}"
                    )
                elif rule:
                    notice_titles += 1
    for problem in problems:
        print(f"FAIL {problem}")
    blocks = sum(1 for rule in RULES if rule["action"] == "block")
    print(
        f"{len(RULES)} rules ({blocks} block, {len(RULES) - blocks} notice), "
        f"{len(SAFE_TITLES)} safe titles, {notice_titles} catalog titles with a heads-up card, "
        f"{len(problems)} problems"
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(_self_check())

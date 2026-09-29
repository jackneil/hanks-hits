#!/usr/bin/env python3
"""
Retro Arcade content blocklist for the catalog generators.

The rules are in apps/web/src/games/retro-arcade/lib/content-blocklist.json.
The web app test (catalog-content.test.ts) reads the same file. Keep
normalize() the same as normalizeTitle() in content-blocklist.ts.

The upload scripts call blocked_rule() before they upload a ROM. A blocked
ROM is not uploaded and does not go into the catalog.

Run this file to check the rules against their examples, the safe titles,
and the reference catalogs in this folder:

    python3 scripts/retro_blocklist.py
"""

import json
import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
BLOCKLIST_PATH = (
    SCRIPTS_DIR.parent
    / "apps" / "web" / "src" / "games" / "retro-arcade" / "lib" / "content-blocklist.json"
)


def load_blocklist(path: Path = BLOCKLIST_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for rule in data["rules"]:
        rule["regex"] = re.compile(rule["pattern"], re.IGNORECASE)
    return data


_BLOCKLIST = load_blocklist()
RULES = _BLOCKLIST["rules"]
SAFE_TITLES = _BLOCKLIST["safeTitles"]


def normalize(text: str) -> str:
    """Lowercase, change '_' and '-' to spaces, and collapse the spaces."""
    text = re.sub(r"[_-]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def without_extension(filename: str) -> str:
    return re.sub(r"\.[a-z0-9]+$", "", filename, flags=re.IGNORECASE)


def blocked_rule(display_name: str, filename: str = "", game_id: str = ""):
    """Return the first rule that blocks this title, or None."""
    texts = [normalize(t) for t in (display_name, without_extension(filename), game_id) if t]
    for rule in RULES:
        if any(rule["regex"].search(text) for text in texts):
            return rule
    return None


def _self_check() -> int:
    problems = []
    for rule in RULES:
        for example in rule["examples"]:
            if not rule["regex"].search(normalize(example)):
                problems.append(f"rule {rule['id']} does not match its example {example!r}")
    for title in SAFE_TITLES:
        rule = blocked_rule(title)
        if rule:
            problems.append(f"safe title {title!r} is blocked by rule {rule['id']}")
    for catalog_file in sorted(SCRIPTS_DIR.glob("*_catalog.json")):
        with open(catalog_file, encoding="utf-8") as f:
            for game in json.load(f):
                rule = blocked_rule(game["displayName"], game["filename"], game["id"])
                if rule:
                    problems.append(
                        f"{catalog_file.name}: {game['displayName']} is blocked by rule {rule['id']}"
                    )
    for problem in problems:
        print(f"FAIL {problem}")
    print(f"{len(RULES)} rules, {len(SAFE_TITLES)} safe titles, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(_self_check())

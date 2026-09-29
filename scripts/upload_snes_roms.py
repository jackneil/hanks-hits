#!/usr/bin/env python3
"""
Upload SNES ROMs to Railway S3 bucket with URL-safe filenames.
Also generates a catalog file for the retro-arcade game.
"""

import os
import re
import json
import boto3
from pathlib import Path
from botocore.config import Config

from retro_blocklist import blocked_rule

# Railway S3 configuration - NEVER COMMIT CREDENTIALS
# Set these environment variables before running:
#   RAILWAY_S3_ENDPOINT
#   RAILWAY_S3_BUCKET
#   RAILWAY_S3_ACCESS_KEY
#   RAILWAY_S3_SECRET_KEY
S3_ENDPOINT = os.environ.get("RAILWAY_S3_ENDPOINT", "https://storage.railway.app")
S3_BUCKET = os.environ.get("RAILWAY_S3_BUCKET")
S3_ACCESS_KEY = os.environ.get("RAILWAY_S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("RAILWAY_S3_SECRET_KEY")

if not all([S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY]):
    raise EnvironmentError(
        "Missing required environment variables. Set:\n"
        "  RAILWAY_S3_BUCKET\n"
        "  RAILWAY_S3_ACCESS_KEY\n"
        "  RAILWAY_S3_SECRET_KEY"
    )

# Source directory
ROM_SOURCE = Path(r"C:\Users\jack\Downloads\SNES Roms by JACK")

# S3 prefix for ROMs
S3_PREFIX = "snes"


def sanitize_filename(filename: str) -> str:
    """Convert filename to URL-safe format."""
    # Remove extension
    name = filename.rsplit(".", 1)[0]

    # Remove translation/version info in brackets
    name = re.sub(r"\s*\[.*?\]", "", name)
    name = re.sub(r"\s*\(.*?\)", "", name)

    # Replace special characters
    name = name.replace("&", "and")
    name = name.replace("'", "")
    name = name.replace("!", "")
    name = name.replace(".", "")
    name = name.replace(",", "")
    name = name.replace(":", "")
    name = name.replace("-", " ")

    # Convert to lowercase and replace spaces with underscores
    name = name.lower().strip()
    name = re.sub(r"\s+", "_", name)

    # Remove any remaining non-alphanumeric characters except underscore
    name = re.sub(r"[^a-z0-9_]", "", name)

    # Remove duplicate underscores
    name = re.sub(r"_+", "_", name)
    name = name.strip("_")

    return f"{name}.smc"


def get_display_name(filename: str) -> str:
    """Extract clean display name from filename."""
    name = filename.rsplit(".", 1)[0]

    # Remove translation/version info in brackets
    name = re.sub(r"\s*\[.*?\]", "", name)
    name = re.sub(r"\s*\(.*?\)", "", name)

    return name.strip()


def categorize_game(name: str) -> str:
    """Guess the genre based on game name."""
    name_lower = name.lower()

    # RPGs
    rpg_keywords = [
        "final fantasy", "chrono", "earthbound", "breath of fire", "lufia",
        "secret of mana", "secrets of mana", "mario rpg", "star ocean",
        "tales of", "ogre battle", "paladin", "robotrek", "soul blazer",
        "terranigma", "illusion of gaia", "evo", "e.v.o", "arcana",
        "bahamut", "romancing saga", "harvest moon", "7th saga", "brain lord",
        "drakkhen", "genghis khan", "uncharted waters", "front mission"
    ]
    if any(kw in name_lower for kw in rpg_keywords):
        return "rpg"

    # Platformers
    platformer_keywords = [
        "mario world", "mario all stars", "donkey kong", "yoshi",
        "mega man", "megaman", "kirby", "earthworm jim", "aladdin",
        "plok", "james pond", "pitfall", "super ghouls", "turrican",
        "sky blazer", "sparkster", "rocket knight"
    ]
    if any(kw in name_lower for kw in platformer_keywords):
        return "platformer"

    # Fighting
    fighting_keywords = [
        "street fighter", "fatal fury", "gundam"
    ]
    if any(kw in name_lower for kw in fighting_keywords):
        return "fighting"

    # Racing
    racing_keywords = [
        "f-zero", "fzero", "mario kart", "rock n roll racing", "rock 'n' roll racing",
        "stunt race", "top gear", "super off road", "uniracers"
    ]
    if any(kw in name_lower for kw in racing_keywords):
        return "racing"

    # Shooters (shmups)
    shooter_keywords = [
        "gradius", "r-type", "axelay", "phalanx", "parodius", "twinbee",
        "un squadron", "cybernator", "metal warriors"
    ]
    if any(kw in name_lower for kw in shooter_keywords):
        return "shooter"

    # Puzzle
    puzzle_keywords = [
        "tetris", "puzzle", "avalanche", "lemmings", "pushover"
    ]
    if any(kw in name_lower for kw in puzzle_keywords):
        return "puzzle"

    # Sports
    sports_keywords = [
        "nba", "football", "baseball", "hockey", "golf", "tennis", "soccer"
    ]
    if any(kw in name_lower for kw in sports_keywords):
        return "sports"

    # Strategy
    strategy_keywords = [
        "civilization", "sim city", "metal marines"
    ]
    if any(kw in name_lower for kw in strategy_keywords):
        return "strategy"

    # Adventure
    adventure_keywords = [
        "zelda", "shadowrun", "flashback", "another world", "prince of persia",
        "demon's crest", "actraiser", "act raiser"
    ]
    if any(kw in name_lower for kw in adventure_keywords):
        return "adventure"

    # Action (catch-all for action games)
    action_keywords = [
        "metroid", "castlevania", "contra", "alien", "battletoads",
        "ninja", "turtles", "zombies", "wild guns", "sunset riders",
        "knights of the round", "final fight", "double dragon",
        "bomberman", "desert strike",
        "starfox", "star fox", "pilotwings", "wolverine", "pocky"
    ]
    if any(kw in name_lower for kw in action_keywords):
        return "action"

    # Default
    return "action"


def is_favorite(name: str) -> bool:
    """Mark popular/classic games as favorites."""
    favorites = [
        "chrono", "zelda", "super mario world", "super mario rpg",
        "super metroid", "earthbound", "final fantasy", "donkey kong",
        "street fighter", "mega man x", "secret of mana", "yoshi's island",
        "mario kart", "f-zero", "castlevania", "contra iii", "kirby"
    ]
    name_lower = name.lower()
    return any(fav in name_lower for fav in favorites)


def upload_roms():
    """Upload all SNES ROMs to S3 and generate catalog."""

    # Create S3 client
    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
    )

    # Find all .smc files
    rom_files = list(ROM_SOURCE.glob("*.smc"))
    print(f"Found {len(rom_files)} ROM files")

    catalog = []
    uploaded = 0
    skipped = 0
    blocked = 0
    seen_filenames = set()  # Two dumps of one game sanitize to the same name

    for rom_path in sorted(rom_files):
        original_name = rom_path.name
        safe_name = sanitize_filename(original_name)

        # Skip duplicates (same sanitized name); a duplicate id breaks the game list
        if safe_name in seen_filenames:
            print(f"  [DUP] {original_name} -> {safe_name} (skipping duplicate)")
            continue
        seen_filenames.add(safe_name)

        display_name = get_display_name(original_name)
        game_id = f"snes-{safe_name.replace('.smc', '').replace('_', '-')}"

        # Kid-safe content: do not upload or list a blocked title
        rule = blocked_rule(display_name, safe_name, game_id)
        if rule:
            print(f"  [BLOCKED] {original_name} ({rule['id']}: {rule['reason']})")
            blocked += 1
            continue

        genre = categorize_game(display_name)
        favorite = is_favorite(display_name)

        s3_key = f"{S3_PREFIX}/{safe_name}"

        # Check if already exists
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=s3_key)
            print(f"  [SKIP] {safe_name} (already exists)")
            skipped += 1
        except:
            # Upload the file
            print(f"  [UPLOAD] {original_name} -> {safe_name}")
            try:
                s3.upload_file(
                    str(rom_path),
                    S3_BUCKET,
                    s3_key,
                    ExtraArgs={
                        "ContentType": "application/octet-stream",
                        "ACL": "public-read",
                    }
                )
                uploaded += 1
            except Exception as e:
                print(f"    ERROR: {e}")
                continue

        # Add to catalog
        catalog.append({
            "id": game_id,
            "displayName": display_name,
            "filename": safe_name,
            "genre": genre,
            "favorite": favorite,
        })

    print(f"\nUpload complete: {uploaded} uploaded, {skipped} skipped, {blocked} blocked")

    # Save catalog as JSON for reference
    catalog_path = Path(__file__).parent / "snes_catalog.json"
    with open(catalog_path, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Catalog saved to {catalog_path}")

    # Generate TypeScript catalog
    generate_typescript_catalog(catalog)

    return catalog


def generate_typescript_catalog(catalog: list):
    """Generate TypeScript catalog file."""

    ts_content = '''// Auto-generated SNES game catalog
// DO NOT EDIT - regenerate using scripts/upload_snes_roms.py

export type GameGenre =
  | "rpg"
  | "platformer"
  | "action"
  | "fighting"
  | "adventure"
  | "racing"
  | "puzzle"
  | "sports"
  | "shooter"
  | "strategy";

export interface CatalogGame {
  id: string;
  displayName: string;
  filename: string;
  genre: GameGenre;
  favorite: boolean;
}

// ROM base URL - env var can override, but the default is the same-origin
// /api/roms proxy (which works in every environment; a bare "/roms" fallback
// used to 404 all of local dev because nothing serves that path)
export const ROM_BASE_URL =
  process.env.NEXT_PUBLIC_ROM_CDN_URL || "/api/roms";

export function getRomUrl(game: CatalogGame): string {
  return `${ROM_BASE_URL}/snes/${game.filename}`;
}

export function searchSnesGames(query: string): CatalogGame[] {
  const q = query.toLowerCase().trim();
  if (!q) return SNES_CATALOG;
  return SNES_CATALOG.filter((g) =>
    g.displayName.toLowerCase().includes(q)
  );
}

export function getSnesGamesByGenre(genre: GameGenre): CatalogGame[] {
  return SNES_CATALOG.filter((g) => g.genre === genre);
}

export function getFeaturedGames(): CatalogGame[] {
  return SNES_CATALOG.filter((g) => g.favorite);
}

export const SNES_CATALOG: CatalogGame[] = [
'''

    for game in sorted(catalog, key=lambda x: x["displayName"]):
        display_name = game['displayName'].replace('"', '\\"')
        favorite_str = "true" if game['favorite'] else "false"
        ts_content += f'''  {{
    id: "{game['id']}",
    displayName: "{display_name}",
    filename: "{game['filename']}",
    genre: "{game['genre']}",
    favorite: {favorite_str},
  }},
'''

    ts_content += "];\n"

    # Save to the retro-arcade lib folder
    ts_path = Path(__file__).parent.parent / "apps" / "web" / "src" / "games" / "retro-arcade" / "lib" / "snes-catalog.ts"
    ts_path.parent.mkdir(parents=True, exist_ok=True)

    with open(ts_path, "w") as f:
        f.write(ts_content)

    print(f"TypeScript catalog saved to {ts_path}")


if __name__ == "__main__":
    upload_roms()

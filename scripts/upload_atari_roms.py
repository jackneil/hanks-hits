#!/usr/bin/env python3
"""
Upload Atari 2600 ROMs to Railway S3 bucket with URL-safe filenames.
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


def check_s3_credentials():
    """Check S3 credentials are set - only needed for upload mode."""
    if not all([S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY]):
        raise EnvironmentError(
            "Missing required environment variables. Set:\n"
            "  RAILWAY_S3_BUCKET\n"
            "  RAILWAY_S3_ACCESS_KEY\n"
            "  RAILWAY_S3_SECRET_KEY"
        )

# Source directory - alphabetical subdirectories (a/, b/, c/...)
ROM_SOURCE = Path(r"C:\Users\jack\Downloads\Atari ROMS by JACK")

# S3 prefix for ROMs
S3_PREFIX = "atari2600"


def sanitize_filename(filename: str) -> str:
    """Convert filename to URL-safe format."""
    # Remove extension
    name = filename.rsplit(".", 1)[0]

    # Remove translation/version info in brackets and parentheses
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

    return f"{name}.bin"


def get_display_name(filename: str) -> str:
    """Extract clean display name from filename."""
    name = filename.rsplit(".", 1)[0]

    # Remove translation/version info in brackets and parentheses
    name = re.sub(r"\s*\[.*?\]", "", name)
    name = re.sub(r"\s*\(.*?\)", "", name)

    return name.strip()


def categorize_game(name: str) -> str:
    """Guess the genre based on game name."""
    name_lower = name.lower()

    # Space/Sci-Fi games
    space_keywords = [
        "asteroids", "space invaders", "defender", "galaxian", "phoenix",
        "cosmic", "star", "alien", "galaxy", "laser", "moon", "astro",
        "stargate", "solar", "planet", "space", "yars"
    ]
    if any(kw in name_lower for kw in space_keywords):
        return "shooter"

    # Sports games
    sports_keywords = [
        "bowling", "basketball", "boxing", "tennis", "golf", "football",
        "soccer", "baseball", "hockey", "olympics", "wrestling", "skiing",
        "fishing", "billiards", "pool", "pong", "video olympics"
    ]
    if any(kw in name_lower for kw in sports_keywords):
        return "sports"

    # Racing games
    racing_keywords = [
        "enduro", "pole position", "indy", "dragster", "race", "racing",
        "grand prix", "turbo", "road", "sprint", "rally", "motocross"
    ]
    if any(kw in name_lower for kw in racing_keywords):
        return "racing"

    # Adventure games
    adventure_keywords = [
        "adventure", "pitfall", "haunted", "e.t.", "indiana jones",
        "jungle", "treasure", "quest", "jungle hunt", "montezuma"
    ]
    if any(kw in name_lower for kw in adventure_keywords):
        return "adventure"

    # Puzzle games
    puzzle_keywords = [
        "breakout", "video chess", "surround", "tetris", "puzzle",
        "othello", "checkers", "backgammon", "chess", "tic-tac-toe",
        "brain", "mastermind", "hangman", "concentration"
    ]
    if any(kw in name_lower for kw in puzzle_keywords):
        return "puzzle"

    # Platformer games
    platformer_keywords = [
        "donkey kong", "mario", "kangaroo", "popeye", "frogger",
        "q*bert", "qbert", "jump", "climber", "kong"
    ]
    if any(kw in name_lower for kw in platformer_keywords):
        return "platformer"

    # Shooter games (non-space)
    shooter_keywords = [
        "combat", "berzerk", "missile command", "centipede", "millipede",
        "tank", "artillery", "battle", "war", "shoot", "gun", "hunter",
        "duck", "warlords", "outlaw", "canyon", "air"
    ]
    if any(kw in name_lower for kw in shooter_keywords):
        return "shooter"

    # Classic arcade
    arcade_keywords = [
        "pac-man", "pacman", "pac man", "ms. pac", "joust", "dig dug",
        "burger", "kaboom", "carnival", "circus", "stampede"
    ]
    if any(kw in name_lower for kw in arcade_keywords):
        return "action"

    # Default
    return "action"


def is_favorite(name: str) -> bool:
    """Mark popular/classic games as favorites."""
    favorites = [
        "adventure", "asteroids", "breakout", "combat", "defender",
        "frogger", "missile command", "pac-man", "pitfall", "space invaders",
        "yars", "centipede", "donkey kong", "river raid", "kaboom",
        "berzerk", "joust", "enduro", "dig dug", "q*bert"
    ]
    name_lower = name.lower()
    return any(fav in name_lower for fav in favorites)


def upload_roms():
    """Upload all Atari 2600 ROMs to S3 and generate catalog."""
    check_s3_credentials()

    # Create S3 client
    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
    )

    # Find all .bin files recursively (files are in a/, b/, c/... subdirs)
    rom_files = list(ROM_SOURCE.glob("**/*.bin"))
    # Also check for uppercase .BIN
    rom_files.extend(ROM_SOURCE.glob("**/*.BIN"))
    print(f"Found {len(rom_files)} ROM files")

    catalog = []
    uploaded = 0
    skipped = 0
    blocked = 0
    seen_filenames = set()  # Track duplicates

    for rom_path in sorted(rom_files, key=lambda p: p.name.lower()):
        original_name = rom_path.name
        safe_name = sanitize_filename(original_name)

        # Skip duplicates (same sanitized name)
        if safe_name in seen_filenames:
            print(f"  [DUP] {original_name} -> {safe_name} (skipping duplicate)")
            continue
        seen_filenames.add(safe_name)

        display_name = get_display_name(original_name)
        game_id = f"atari2600-{safe_name.replace('.bin', '').replace('_', '-')}"

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
    print(f"Total unique games in catalog: {len(catalog)}")

    # Save catalog as JSON for reference
    catalog_path = Path(__file__).parent / "atari_2600_catalog.json"
    with open(catalog_path, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Catalog saved to {catalog_path}")

    # Generate TypeScript catalog
    generate_typescript_catalog(catalog)

    return catalog


def generate_typescript_catalog(catalog: list):
    """Generate TypeScript catalog file."""

    ts_content = '''// Auto-generated Atari 2600 game catalog
// DO NOT EDIT - regenerate using scripts/upload_atari_roms.py

export type GameGenre =
  | "shooter"
  | "platformer"
  | "action"
  | "adventure"
  | "racing"
  | "puzzle"
  | "sports";

export interface CatalogGame {
  id: string;
  displayName: string;
  filename: string;
  genre: GameGenre;
  favorite: boolean;
}

// ROM base URL - env var can override, but the default is the same-origin
// /api/roms proxy (works in every environment; the old "/roms" fallback
// 404'd all of local dev)
export const ROM_BASE_URL =
  process.env.NEXT_PUBLIC_ROM_CDN_URL || "/api/roms";

export function getRomUrl(game: CatalogGame): string {
  return `${ROM_BASE_URL}/atari2600/${game.filename}`;
}

export function searchAtariGames(query: string): CatalogGame[] {
  const q = query.toLowerCase().trim();
  if (!q) return ATARI_2600_CATALOG;
  return ATARI_2600_CATALOG.filter((g) =>
    g.displayName.toLowerCase().includes(q)
  );
}

export function getAtariGamesByGenre(genre: GameGenre): CatalogGame[] {
  return ATARI_2600_CATALOG.filter((g) => g.genre === genre);
}

export function getFeaturedAtariGames(): CatalogGame[] {
  return ATARI_2600_CATALOG.filter((g) => g.favorite);
}

export const ATARI_2600_CATALOG: CatalogGame[] = [
'''

    for game in sorted(catalog, key=lambda x: x["displayName"].lower()):
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
    ts_path = Path(__file__).parent.parent / "apps" / "web" / "src" / "games" / "retro-arcade" / "lib" / "atari-2600-catalog.ts"
    ts_path.parent.mkdir(parents=True, exist_ok=True)

    with open(ts_path, "w") as f:
        f.write(ts_content)

    print(f"TypeScript catalog saved to {ts_path}")


def generate_catalog_only():
    """Generate catalog without uploading - for testing."""
    rom_files = list(ROM_SOURCE.glob("**/*.bin"))
    rom_files.extend(ROM_SOURCE.glob("**/*.BIN"))
    print(f"Found {len(rom_files)} ROM files")

    catalog = []
    seen_filenames = set()

    for rom_path in sorted(rom_files, key=lambda p: p.name.lower()):
        original_name = rom_path.name
        safe_name = sanitize_filename(original_name)

        if safe_name in seen_filenames:
            continue
        seen_filenames.add(safe_name)

        display_name = get_display_name(original_name)
        game_id = f"atari2600-{safe_name.replace('.bin', '').replace('_', '-')}"

        # Kid-safe content: do not list a blocked title
        rule = blocked_rule(display_name, safe_name, game_id)
        if rule:
            print(f"  [BLOCKED] {original_name} ({rule['id']}: {rule['reason']})")
            continue

        genre = categorize_game(display_name)
        favorite = is_favorite(display_name)

        catalog.append({
            "id": game_id,
            "displayName": display_name,
            "filename": safe_name,
            "genre": genre,
            "favorite": favorite,
        })

    print(f"Total unique games: {len(catalog)}")

    # Save catalog as JSON
    catalog_path = Path(__file__).parent / "atari_2600_catalog.json"
    with open(catalog_path, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Catalog saved to {catalog_path}")

    # Generate TypeScript
    generate_typescript_catalog(catalog)

    return catalog


if __name__ == "__main__":
    import sys
    if "--catalog-only" in sys.argv:
        generate_catalog_only()
    else:
        upload_roms()

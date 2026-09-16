#!/usr/bin/env python3
"""
KSB Table Tennis database updater.

What this does:
- Keeps 2013-2025 as the historic/local layer.
- Detects/uses the configured current season (2026 initially).
- Fetches current-season KSB team and player data from East Lancs TT.
- Rebuilds current-season individual encounters from the player API.
- Calculates current-season, historic and combined/career statistics.
- Writes ksb_master_database.json.

Usage:
    python update_ksb_database.py

Optional:
    python update_ksb_database.py --season 2026
    python update_ksb_database.py --master path/to/ksb_master_database.json
    python update_ksb_database.py --timeout 20

When a season is finished:
1. Set HISTORIC_END_SEASON to the finished season.
2. Run the script once to archive it.
3. Change CURRENT_SEASON to the next season.
   The script deliberately does NOT automatically move a season into
   historic storage, because that is a data-integrity decision.
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_MASTER = SCRIPT_DIR / "ksb_master_database.json"
DEFAULT_LEAGUE_HISTORY = SCRIPT_DIR / "league-history.json"
DEFAULT_TIMEOUT = 30

# These are deliberately conservative. Update these two values when a new
# season begins/ends.
HISTORIC_END_SEASON = 2025
CURRENT_SEASON = 2026

KSB_TEAM_SLUGS = [
    "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e", "ksb-f", "ksb-g",
    "ksb-lions", "ksb-tigers-jun", "ksb-jaguars", "ksb-pumas-jun",
    "ksb-leopards-jun", "ksb-panthers-jun"
]

DIVISION_SLUGS = ("premier", "first", "second", "third")

BASE = "https://eastlancstt.org.uk"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def get_json(url, timeout):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KSB-Table-Tennis-Database/2.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def safe_get(url, timeout):
    try:
        return {"status": "success", "data": get_json(url, timeout), "error": None}
    except urllib.error.HTTPError as e:
        return {"status": "http_error", "data": None, "error": f"HTTP {e.code}"}
    except urllib.error.URLError as e:
        return {"status": "network_error", "data": None, "error": str(e.reason)}
    except Exception as e:
        return {"status": "error", "data": None, "error": str(e)}


def aggregate(records):
    played = wins = draws = losses = sets_won = sets_lost = 0
    for rec in records:
        st = rec.get("statistics") or {}
        played += int(st.get("played") or 0)
        wins += int(st.get("wins") or 0)
        draws += int(st.get("draws") or 0)
        losses += int(st.get("losses") or 0)
        sets_won += int(st.get("setsWon") or 0)
        sets_lost += int(st.get("setsLost") or 0)
    return {
        "played": played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "winPercentage": round((wins / played) * 100, 2) if played else 0,
        "setsWon": sets_won,
        "setsLost": sets_lost,
        "setDifference": sets_won - sets_lost,
    }


def fixture_key(season, fixture):
    """Return the canonical identity used by both team and player records."""
    week = fixture.get("weekId")
    left = fixture.get("teamLeftSlug") or ""
    right = fixture.get("teamRightSlug") or ""
    fulfilled = fixture.get("timeFulfilled") or ""
    return f"{season}|{week}|{left}|{right}|{fulfilled}"


def build_player_season(player_data, season):
    """Normalise one player API response into current-season records."""
    api_player = player_data.get("player") or {}
    player_name = api_player.get("name") or "Unknown player"
    player_slug = api_player.get("slug") or ""
    raw_encounters = player_data.get("encounters") or []
    fixtures = player_data.get("fixtures") or []
    completed = [f for f in fixtures if f.get("scoreLeft") is not None and f.get("scoreRight") is not None]

    encounters = []
    for index, raw in enumerate(raw_encounters):
        left_slug = raw.get("playerLeftSlug")
        right_slug = raw.get("playerRightSlug")
        left_name = raw.get("playerLeftName")
        right_name = raw.get("playerRightName")
        left_score = raw.get("scoreLeft")
        right_score = raw.get("scoreRight")

        on_left = left_slug == player_slug or (not player_slug and left_name == player_name)
        on_right = right_slug == player_slug or (not player_slug and right_name == player_name)
        if not on_left and not on_right:
            continue

        player_score = left_score if on_left else right_score
        opponent_score = right_score if on_left else left_score
        opponent = right_name if on_left else left_name
        opponent_slug = right_slug if on_left else left_slug
        result = "D"
        if player_score is not None and opponent_score is not None:
            if int(player_score) > int(opponent_score):
                result = "W"
            elif int(player_score) < int(opponent_score):
                result = "L"

        # League teams field three players, each playing three singles. The
        # player API orders encounter blocks in the same order as that player's
        # completed fixture list. Store the canonical fixture key at ingestion.
        fixture_index = index // 3
        linked_fixture = completed[fixture_index] if fixture_index < len(completed) else None
        encounter = dict(raw)
        encounter.update({
            "player": player_name,
            "playerSlug": player_slug,
            "opponent": opponent,
            "opponentSlug": opponent_slug,
            "playerScore": player_score,
            "opponentScore": opponent_score,
            "result": result,
            "fixtureKey": fixture_key(season, linked_fixture) if linked_fixture else None,
        })
        encounters.append(encounter)

    wins = sum(e["result"] == "W" for e in encounters)
    draws = sum(e["result"] == "D" for e in encounters)
    losses = sum(e["result"] == "L" for e in encounters)
    sets_won = sum(int(e["playerScore"] or 0) for e in encounters)
    sets_lost = sum(int(e["opponentScore"] or 0) for e in encounters)
    opponents = {}
    for encounter in encounters:
        key = encounter.get("opponentSlug") or encounter.get("opponent")
        if not key:
            continue
        row = opponents.setdefault(key, {"name": encounter["opponent"], "slug": encounter.get("opponentSlug"), "played": 0, "wins": 0, "draws": 0, "losses": 0})
        row["played"] += 1
        row[{"W": "wins", "D": "draws", "L": "losses"}[encounter["result"]]] += 1
    for row in opponents.values():
        row["winPercentage"] = round(row["wins"] / row["played"] * 100, 2) if row["played"] else 0

    played = len(encounters)
    statistics = {
        "played": played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "winPercentage": round(wins / played * 100, 2) if played else 0,
        "setsWon": sets_won,
        "setsLost": sets_lost,
        "setDifference": sets_won - sets_lost,
        "opponents": sorted(opponents.values(), key=lambda row: row["name"].lower()),
        "encounters": encounters,
    }
    return {
        "season": season,
        "player": api_player,
        "team": player_data.get("team") or {},
        "statistics": statistics,
        "fixtures": [{**fixture, "fixtureKey": fixture_key(season, fixture)} for fixture in fixtures],
        "weeks": player_data.get("weeks") or [],
        "api": {"status": "success"},
    }

def first_value(row, *names, default=None):
    for name in names:
        if isinstance(row, dict) and row.get(name) is not None:
            return row[name]
    return default


def normalise_league_table(payload):
    """Convert the league API response to the compact format used by team-template.js."""
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = first_value(payload, "league", "table", "rows", "standings", "teams", "data", default=[])
        if isinstance(rows, dict):
            rows = first_value(rows, "league", "table", "rows", "standings", "teams", default=[])
    else:
        rows = []

    output = []
    for index, row in enumerate(rows or [], 1):
        if not isinstance(row, dict):
            continue
        team = first_value(row, "t", "team", "teamName", "name")
        if isinstance(team, dict):
            team = first_value(team, "name", "teamName", "t")
        if not team:
            continue
        output.append({
            "p": int(first_value(row, "p", "position", "pos", "rank", default=index) or index),
            "t": str(team),
            "w": int(first_value(row, "w", "won", "wins", default=0) or 0),
            "d": int(first_value(row, "d", "drawn", "draws", default=0) or 0),
            "l": int(first_value(row, "l", "lost", "losses", default=0) or 0),
            "pl": int(first_value(row, "pl", "played", "matchesPlayed", default=0) or 0),
            "pts": int(first_value(row, "pts", "points", "score", default=0) or 0),
        })
    return sorted(output, key=lambda row: row["p"])


def update_current_leagues(season, timeout, league_history_path):
    """Replace only the selected current season in league-history.json."""
    if league_history_path.exists():
        archive = json.loads(league_history_path.read_text(encoding="utf-8"))
    else:
        archive = {"data": {}, "statuses": {}}
    archive.setdefault("data", {})
    archive.setdefault("statuses", {})
    season_key = str(season)
    current = {}
    statuses = {}
    for division in DIVISION_SLUGS:
        url = f"{BASE}/api/result/{season}/{division}/league"
        result = safe_get(url, timeout)
        statuses[division] = {"url": url, "status": result["status"], "error": result.get("error")}
        if result["status"] != "success":
            print(f"  league {division}: {result['status']} - {result['error']}")
            continue
        current[division] = normalise_league_table(result["data"])
        print(f"  league {division}: {len(current[division])} teams")
    if current:
        archive["data"][season_key] = current
        archive["statuses"][season_key] = statuses
        archive["currentSeason"] = season
        archive["lastUpdated"] = utc_now()
        league_history_path.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
    return current


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", default=str(DEFAULT_MASTER))
    parser.add_argument("--league-history", default=str(DEFAULT_LEAGUE_HISTORY))
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()

    master_path = Path(args.master).resolve()
    league_history_path = Path(args.league_history).resolve()
    if not master_path.exists():
        raise SystemExit(
            f"Could not find {master_path}. Put this script beside "
            f"ksb_master_database.json or use --master."
        )

    with master_path.open("r", encoding="utf-8") as f:
        master = json.load(f)

    season = args.season or master.get("coverage", {}).get("currentSeason") or CURRENT_SEASON
    historic_end = int(master.get("coverage", {}).get("historicEndSeason", HISTORIC_END_SEASON))

    # Keep the local historic layer intact. If the chosen current season is
    # already historic, stop rather than silently mixing layers.
    if season <= historic_end:
        raise SystemExit(
            f"Current season {season} is <= historic end {historic_end}. "
            "Increase the current season or deliberately archive/update the "
            "historic layer first."
        )

    print(f"Updating KSB current season: {season}")
    print("Fetching KSB team data...")

    teams = {}
    player_slugs = {}
    all_fixtures = []
    all_weeks = []

    for team_slug in KSB_TEAM_SLUGS:
        url = f"{BASE}/api/result/{season}/team/{team_slug}"
        result = safe_get(url, args.timeout)
        if result["status"] != "success":
            print(f"  {team_slug}: {result['status']} - {result['error']}")
            continue

        data = result["data"]
        team = data.get("team") or {}
        players = data.get("players") or []
        fixtures = data.get("fixtures") or []
        weeks = data.get("weeks") or []

        teams[team_slug] = {
            "source": url,
            "status": "success",
            "team": team,
            "players": players,
            "fixtures": fixtures,
            "weeks": weeks
        }

        for p in players:
            if p.get("slug"):
                player_slugs[p["slug"]] = p

        all_fixtures.extend(fixtures)
        all_weeks.extend(weeks)
        print(f"  {team_slug}: {len(players)} players, {len(fixtures)} fixtures")

    print(f"Found {len(player_slugs)} current-season player slugs.")
    print("Fetching individual player data...")

    current_players = {}
    encounters = []
    successful = 0
    failed = 0

    for i, (slug, basic_player) in enumerate(sorted(player_slugs.items()), 1):
        url = f"{BASE}/api/result/{season}/player/{slug}"
        result = safe_get(url, args.timeout)
        if result["status"] != "success":
            print(f"  [{i}/{len(player_slugs)}] {slug}: FAILED {result['error']}")
            failed += 1
            continue

        record = build_player_season(result["data"], season)
        current_players[slug] = record
        encounters.extend(record["statistics"]["encounters"])
        successful += 1

        if i % 20 == 0 or i == len(player_slugs):
            print(f"  [{i}/{len(player_slugs)}] complete")

        # Be polite to the public API.
        time.sleep(0.05)

    # Update current-season data.
    master["coverage"]["currentSeason"] = season
    master["currentSeason"] = {
        "season": season,
        "status": "live",
        "lastUpdated": utc_now(),
        "teams": teams,
        "players": current_players,
        "encounters": encounters,
        "fixtures": all_fixtures,
        "weeks": all_weeks,
        "api": {
            "status": "success" if successful else "failed",
            "successfulPlayerRequests": successful,
            "failedPlayerRequests": failed
        }
    }

    # Recalculate each player's historic/current/career layers.
    for slug, player in master.get("players", {}).items():
        historical_records = [
            rec for s, rec in player.get("seasons", {}).items()
            if int(s) <= historic_end
        ]
        historic_stats = aggregate(historical_records)

        current = current_players.get(slug)
        current_stats = (current or {}).get("statistics") if current else None
        if current_stats:
            current_summary = {
                k: current_stats[k]
                for k in [
                    "played", "wins", "draws", "losses",
                    "winPercentage", "setsWon", "setsLost", "setDifference"
                ]
            }
        else:
            current_summary = {
                "played": 0, "wins": 0, "draws": 0, "losses": 0,
                "winPercentage": 0, "setsWon": 0, "setsLost": 0,
                "setDifference": 0
            }

        combined = {
            "played": historic_stats["played"] + current_summary["played"],
            "wins": historic_stats["wins"] + current_summary["wins"],
            "draws": historic_stats["draws"] + current_summary["draws"],
            "losses": historic_stats["losses"] + current_summary["losses"],
            "setsWon": historic_stats["setsWon"] + current_summary["setsWon"],
            "setsLost": historic_stats["setsLost"] + current_summary["setsLost"]
        }
        combined["winPercentage"] = (
            round((combined["wins"] / combined["played"]) * 100, 2)
            if combined["played"] else 0
        )
        combined["setDifference"] = combined["setsWon"] - combined["setsLost"]

        player["historic"] = historic_stats
        player["currentSeason"] = current_summary
        player["career"] = combined

        if current:
            player["seasons"][str(season)] = current

    # Add any new current-season players that did not exist historically.
    for slug, current in current_players.items():
        if slug not in master["players"]:
            stats = current["statistics"]
            current_summary = {
                k: stats[k] for k in [
                    "played", "wins", "draws", "losses",
                    "winPercentage", "setsWon", "setsLost", "setDifference"
                ]
            }
            master["players"][slug] = {
                "name": current["player"]["name"],
                "slug": slug,
                "historicThrough": historic_end,
                "historic": {
                    "played": 0, "wins": 0, "draws": 0, "losses": 0,
                    "winPercentage": 0, "setsWon": 0, "setsLost": 0,
                    "setDifference": 0
                },
                "currentSeason": current_summary,
                "career": current_summary.copy(),
                "seasons": {str(season): current}
            }

    print("Fetching current league tables...")
    current_leagues = update_current_leagues(season, args.timeout, league_history_path)
    master["currentSeason"]["leagues"] = current_leagues

    master["coverage"]["lastUpdated"] = utc_now()
    master["coverage"]["livePlayerCount"] = len(current_players)
    master["coverage"]["liveEncounterCount"] = len(encounters)

    with master_path.open("w", encoding="utf-8") as f:
        json.dump(master, f, ensure_ascii=False, indent=2)

    print()
    print("Done.")
    print(f"Master database: {master_path}")
    print(f"Current season: {season}")
    print(f"League history: {league_history_path}")
    print(f"Live players: {len(current_players)}")
    print(f"Live encounters: {len(encounters)}")
    print(f"Successful player requests: {successful}")
    print(f"Failed player requests: {failed}")
    print()
    print("The historic layer was not overwritten.")


if __name__ == "__main__":
    main()

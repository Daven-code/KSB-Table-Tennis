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

DEFAULT_MASTER = "ksb_master_database.json"
DEFAULT_TIMEOUT = 20

# These are deliberately conservative. Update these two values when a new
# season begins/ends.
HISTORIC_END_SEASON = 2025
CURRENT_SEASON = 2026

KSB_TEAM_SLUGS = [
    "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e", "ksb-f", "ksb-g",
    "ksb-h", "ksb-juniors", "ksb-juniors-1", "ksb-juniors-2",
    "ksb-juniors-3", "ksb-juniors-4", "ksb-lions", "ksb-tigers-jun",
    "ksb-jaguars", "ksb-pumas-jun", "ksb-leopards-jun",
    "ksb-panthers-jun"
]

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


def build_player_season(player_data, season):
    p = player_data.get("player") or {}
    encounters = []
    for e in player_data.get("encounters") or []:
        player = p.get("name") or e.get("player")
        player_slug = p.get("slug") or e.get("playerSlug")
        left = e.get("playerLeftName")
        right = e.get("playerRightName")
        if e.get("playerSlug") == player_slug:
            player_score = e.get("playerScore")
            opponent_score = e.get("opponentScore")
            opponent = e.get("opponent")
            opponent_slug = e.get("opponentSlug")
        else:
            # The API normally supplies player/opponent fields already, but
            # this fallback makes the record robust if they are absent.
            player_score = e.get("playerScore")
            opponent_score = e.get("opponentScore")
            opponent = e.get("opponent") or (right if left == player else left)
            opponent_slug = e.get("opponentSlug")
        result = e.get("result")
        encounters.append({
            "id": e.get("id"),
            "scoreLeft": e.get("scoreLeft"),
            "scoreRight": e.get("scoreRight"),
            "playerLeftName": left,
            "playerLeftSlug": e.get("playerLeftSlug"),
            "playerRightName": right,
            "playerRightSlug": e.get("playerRightSlug"),
            "playerRankChangeLeft": e.get("playerRankChangeLeft"),
            "playerRankChangeRight": e.get("playerRankChangeRight"),
            "player": player,
            "playerSlug": player_slug,
            "opponent": opponent,
            "opponentSlug": opponent_slug,
            "playerScore": player_score,
            "opponentScore": opponent_score,
            "result": result,
        })

    # Recalculate basic statistics from encounters so the master DB is
    # self-consistent even if the API's summary fields change.
    played = len(encounters)
    wins = sum(1 for e in encounters if e["result"] == "W")
    losses = sum(1 for e in encounters if e["result"] == "L")
    draws = sum(1 for e in encounters if e["result"] == "D")
    sets_won = sum(int(e["playerScore"] or 0) for e in encounters)
    sets_lost = sum(int(e["opponentScore"] or 0) for e in encounters)

    opponents = {}
    for e in encounters:
        s = e["opponentSlug"]
        if not s:
            continue
        o = opponents.setdefault(s, {
            "name": e["opponent"],
            "slug": s,
            "played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0
        })
        o["played"] += 1
        if e["result"] == "W":
            o["wins"] += 1
        elif e["result"] == "D":
            o["draws"] += 1
        elif e["result"] == "L":
            o["losses"] += 1
    for o in opponents.values():
        o["winPercentage"] = round((o["wins"] / o["played"]) * 100, 2) if o["played"] else 0
    opponents = sorted(opponents.values(), key=lambda x: x["name"].lower())

    stats = {
        "played": played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "winPercentage": round((wins / played) * 100, 2) if played else 0,
        "setsWon": sets_won,
        "setsLost": sets_lost,
        "setDifference": sets_won - sets_lost,
        "opponents": opponents,
        "encounters": encounters
    }

    return {
        "season": season,
        "player": {
            "id": p.get("id"),
            "name": p.get("name"),
            "slug": p.get("slug"),
            "rank": p.get("rank")
        },
        "team": {
            "id": p.get("teamId"),
            "name": p.get("teamName"),
            "slug": p.get("teamSlug"),
            "divisionId": p.get("divisionId")
        },
        "statistics": stats,
        "fixtures": player_data.get("fixtures") or [],
        "weeks": player_data.get("weeks") or [],
        "api": {
            "url": f"{BASE}/api/result/{season}/player/{p.get('slug')}",
            "status": "success"
        }
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", default=DEFAULT_MASTER)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()

    master_path = Path(args.master)
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

    master["coverage"]["lastUpdated"] = utc_now()
    master["coverage"]["livePlayerCount"] = len(current_players)
    master["coverage"]["liveEncounterCount"] = len(encounters)

    with master_path.open("w", encoding="utf-8") as f:
        json.dump(master, f, ensure_ascii=False, indent=2)

    print()
    print("Done.")
    print(f"Master database: {master_path}")
    print(f"Current season: {season}")
    print(f"Live players: {len(current_players)}")
    print(f"Live encounters: {len(encounters)}")
    print(f"Successful player requests: {successful}")
    print(f"Failed player requests: {failed}")
    print()
    print("The historic layer was not overwritten.")


if __name__ == "__main__":
    main()

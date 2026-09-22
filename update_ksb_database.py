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
    """Download and decode one JSON API response."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; KSB-Table-Tennis-Database/3.0)",
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def safe_get(url, timeout, attempts=4, retry_delay=3.0):
    """Request JSON with bounded retries for transient league-site failures."""
    errors = []
    for attempt in range(1, attempts + 1):
        try:
            return {"status": "success", "data": get_json(url, timeout), "error": None, "attempts": attempt}
        except urllib.error.HTTPError as error:
            detail = f"HTTP {error.code}"
            # Most 4xx responses are permanent for this run; 408/429 can be transient.
            if error.code not in (408, 429) and 400 <= error.code < 500:
                return {"status": "http_error", "data": None, "error": detail, "attempts": attempt}
        except urllib.error.URLError as error:
            detail = str(error.reason)
        except TimeoutError as error:
            detail = str(error) or "request timed out"
        except Exception as error:
            detail = str(error)
        errors.append(f"attempt {attempt}: {detail}")
        if attempt < attempts:
            time.sleep(retry_delay * attempt)
    return {"status": "error", "data": None, "error": "; ".join(errors), "attempts": attempts}

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


def build_player_season(player_data, season, opponent_teams_by_player):
    """Normalise one player API response into current-season records."""
    api_player = player_data.get("player") or {}
    player_name = api_player.get("name") or "Unknown player"
    player_slug = api_player.get("slug") or ""
    raw_encounters = player_data.get("encounters") or []
    fixtures = player_data.get("fixtures") or []
    completed = [f for f in fixtures if f.get("scoreLeft") is not None and f.get("scoreRight") is not None]
    player_team_slug = (player_data.get("team") or {}).get("slug") or api_player.get("teamSlug")

    def opposing_team_slug(fixture):
        """Return the other team in a fixture involving this player's team."""
        left = fixture.get("teamLeftSlug")
        right = fixture.get("teamRightSlug")
        if player_team_slug and left == player_team_slug:
            return right
        if player_team_slug and right == player_team_slug:
            return left
        return None

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

        # Link by identity, never by array position. The old index // 3 rule
        # placed late or reordered encounters under the wrong team result.
        # An encounter belongs to the completed fixture whose opposition team
        # roster contains the opponent's player slug.
        registered_teams = opponent_teams_by_player.get(opponent_slug, set())
        candidates = [
            fixture for fixture in completed
            if opposing_team_slug(fixture) in registered_teams
        ]
        linked_fixture = candidates[0] if len(candidates) == 1 else None
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
        played = int(first_value(row, "pl", "played", "matchesPlayed", "matches", default=0) or 0)
        wins = int(first_value(row, "w", "won", "wins", "matchesWon", default=0) or 0)
        draws = int(first_value(row, "d", "drawn", "draws", "matchesDrawn", default=0) or 0)
        # Some current league responses omit a dedicated losses field. Losses
        # are an invariant of the table, so derive them from played, wins and
        # draws whenever no explicit value is supplied.
        raw_losses = first_value(row, "l", "lost", "losses", "matchesLost", default=None)
        calculated_losses = max(0, played - wins - draws)
        # The current API is returning 0 in its losses field for every row.
        # When that conflicts with the table invariant P = W + D + L, the
        # invariant is authoritative. Explicit non-conflicting values remain.
        supplied_losses = int(raw_losses) if raw_losses is not None else calculated_losses
        losses = supplied_losses if played == wins + draws + supplied_losses else calculated_losses
        output.append({
            "p": int(first_value(row, "p", "position", "pos", "rank", default=index) or index),
            "t": str(team),
            "w": wins,
            "d": draws,
            "l": losses,
            "pl": played,
            "pts": int(first_value(row, "pts", "points", "score", default=0) or 0),
        })
    return sorted(output, key=lambda row: row["p"])


def update_current_leagues(season, timeout, league_history_path, attempts=4, retry_delay=3.0):
    """Refresh every available division without discarding last-known-good data.

    A successful empty response is valid at the start of a season. A failed
    request retains that division's previous current-season snapshot, while
    other successful divisions still update.
    """
    if league_history_path.exists():
        archive = json.loads(league_history_path.read_text(encoding="utf-8"))
    else:
        archive = {"data": {}, "statuses": {}}
    archive.setdefault("data", {})
    archive.setdefault("statuses", {})
    season_key = str(season)
    previous = archive["data"].get(season_key, {})
    current = {}
    statuses = {}
    for division in DIVISION_SLUGS:
        url = f"{BASE}/api/result/{season}/{division}/league"
        result = safe_get(url, timeout, attempts, retry_delay)
        if result["status"] == "success":
            current[division] = normalise_league_table(result["data"])
            state = "updated"
        else:
            current[division] = previous.get(division, [])
            state = "retained-previous"
        statuses[division] = {
            "url": url,
            "status": result["status"],
            "state": state,
            "error": result.get("error"),
            "attempts": result.get("attempts"),
            "teamCount": len(current[division]),
        }
        print(f"  league {division}: {state}, {len(current[division])} teams")
    archive["data"][season_key] = current
    archive["statuses"][season_key] = statuses
    archive["currentSeason"] = season
    archive["lastUpdated"] = utc_now()
    temporary = league_history_path.with_suffix(league_history_path.suffix + ".tmp")
    temporary.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(league_history_path)
    return current, statuses


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", default=str(DEFAULT_MASTER))
    parser.add_argument("--league-history", default=str(DEFAULT_LEAGUE_HISTORY))
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--attempts", type=int, default=4)
    parser.add_argument("--retry-delay", type=float, default=3.0)
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
    previous_current = master.get("currentSeason", {}) if int(master.get("currentSeason", {}).get("season") or 0) == int(season) else {}
    previous_teams = previous_current.get("teams", {})
    previous_players = previous_current.get("players", {})

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
    team_failures = []

    for team_slug in KSB_TEAM_SLUGS:
        url = f"{BASE}/api/result/{season}/team/{team_slug}"
        result = safe_get(url, args.timeout, args.attempts, args.retry_delay)
        if result["status"] != "success":
            team_failures.append(f"{team_slug}: {result['error']}")
            if team_slug in previous_teams:
                teams[team_slug] = previous_teams[team_slug]
                teams[team_slug]["updateStatus"] = "retained-previous"
                teams[team_slug]["lastError"] = result["error"]
                for player in teams[team_slug].get("players") or []:
                    if player.get("slug"):
                        player_slugs[player["slug"]] = player
                all_fixtures.extend(teams[team_slug].get("fixtures") or [])
                all_weeks.extend(teams[team_slug].get("weeks") or [])
                print(f"  {team_slug}: unavailable; retained previous current-season data")
            else:
                teams[team_slug] = {"source": url, "status": "unavailable", "updateStatus": "not-published", "lastError": result["error"], "team": {"slug": team_slug}, "players": [], "fixtures": [], "weeks": []}
                print(f"  {team_slug}: unavailable and no previous current-season data; placeholder retained")
            continue

        data = result["data"]
        team = data.get("team") or {}
        players = data.get("players") or []
        fixtures = data.get("fixtures") or []
        weeks = data.get("weeks") or []

        teams[team_slug] = {
            "source": url,
            "status": "success",
            "updateStatus": "updated",
            "lastError": None,
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

    if team_failures:
        print(f"Continuing with {len(team_failures)} unavailable team API(s); previous data or placeholders were retained.")

    print(f"Found {len(player_slugs)} current-season player slugs.")

    # Build an exact current-season player-to-team index from every opposition
    # team appearing in a KSB fixture. This is the authoritative link between
    # an individual encounter and its team fixture.
    fixture_team_slugs = {
        slug
        for fixture in all_fixtures
        for slug in (fixture.get("teamLeftSlug"), fixture.get("teamRightSlug"))
        if slug
    }
    opponent_teams_by_player = {}
    print(f"Fetching {len(fixture_team_slugs)} fixture-team rosters for exact result linking...")
    for i, fixture_team_slug in enumerate(sorted(fixture_team_slugs), 1):
        if fixture_team_slug in teams and teams[fixture_team_slug].get("players") is not None:
            roster = teams[fixture_team_slug].get("players") or []
        else:
            team_url = f"{BASE}/api/result/{season}/team/{fixture_team_slug}"
            team_result = safe_get(team_url, args.timeout, args.attempts, args.retry_delay)
            if team_result["status"] != "success":
                print(f"  roster {fixture_team_slug}: unavailable; its encounters will remain unlinked this run")
                continue
            roster = (team_result["data"] or {}).get("players") or []
        for roster_player in roster:
            roster_slug = roster_player.get("slug")
            if roster_slug:
                opponent_teams_by_player.setdefault(roster_slug, set()).add(fixture_team_slug)
        if i % 10 == 0 or i == len(fixture_team_slugs):
            print(f"  [{i}/{len(fixture_team_slugs)}] fixture-team rosters complete")

    print("Fetching individual player data...")

    current_players = {}
    encounters = []
    successful = 0
    failed = 0

    for i, (slug, basic_player) in enumerate(sorted(player_slugs.items()), 1):
        url = f"{BASE}/api/result/{season}/player/{slug}"
        result = safe_get(url, args.timeout, args.attempts, args.retry_delay)
        if result["status"] != "success":
            if slug in previous_players:
                retained = previous_players[slug]
                retained.setdefault("api", {})
                retained["api"].update({"status": "retained-previous", "lastError": result["error"]})
                current_players[slug] = retained
                encounters.extend((retained.get("statistics") or {}).get("encounters") or [])
                print(f"  [{i}/{len(player_slugs)}] {slug}: unavailable; retained previous current-season record")
            else:
                print(f"  [{i}/{len(player_slugs)}] {slug}: unavailable and no previous record; skipped for this run")
            failed += 1
            continue

        record = build_player_season(result["data"], season, opponent_teams_by_player)
        current_players[slug] = record
        encounters.extend(record["statistics"]["encounters"])
        successful += 1

        if i % 20 == 0 or i == len(player_slugs):
            print(f"  [{i}/{len(player_slugs)}] complete")

        # Be polite to the public API.
        time.sleep(0.05)

    if failed:
        print(f"Continuing after {failed} unavailable player API request(s); available and retained records will be published.")
    linked_encounters = sum(bool(item.get("fixtureKey")) for item in encounters)
    unlinked_encounters = len(encounters) - linked_encounters
    print(f"Current encounters linked to exact fixtures: {linked_encounters}; unlinked: {unlinked_encounters}")

    # Update current-season data only after every required API request succeeds.
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
            "status": "partial" if team_failures or failed else "success",
            "successfulPlayerRequests": successful,
            "failedPlayerRequests": failed,
            "failedTeamRequests": len(team_failures),
            "teamErrors": team_failures
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
    current_leagues, league_statuses = update_current_leagues(season, args.timeout, league_history_path, args.attempts, args.retry_delay)
    master["currentSeason"]["leagues"] = current_leagues
    master["currentSeason"]["leagueApi"] = league_statuses

    master["coverage"]["lastUpdated"] = utc_now()
    master["coverage"]["livePlayerCount"] = len(current_players)
    master["coverage"]["liveEncounterCount"] = len(encounters)

    temporary_master = master_path.with_suffix(master_path.suffix + ".tmp")
    temporary_master.write_text(json.dumps(master, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_master.replace(master_path)

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

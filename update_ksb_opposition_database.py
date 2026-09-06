#!/usr/bin/env python3
"""
KSB Opposition Database updater (v2).

Purpose
-------
Build a separate database of every non-KSB player who has appeared as an
opponent in a KSB individual encounter, and enrich each opponent/season with
that player's East Lancashire TT team, division and rank.

The KSB master database remains untouched.

Usage
-----
    python update_ksb_opposition_database_v2.py
    python update_ksb_opposition_database_v2.py --master ksb_master_database.json
    python update_ksb_opposition_database_v2.py --output ksb_opposition_database.json
    python update_ksb_opposition_database_v2.py --delay 0.15 --timeout 20

The script is incremental: an already-successful season/player lookup is
reused unless --refresh is supplied. Failed/pending lookups are retried.
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://eastlancstt.org.uk"
DEFAULT_MASTER = "ksb_master_database.json"
DEFAULT_OUTPUT = "ksb_opposition_database.json"
DEFAULT_CACHE = "ksb_opposition_api_cache.json"
DEFAULT_TIMEOUT = 20
DEFAULT_DELAY = 0.15

KSB_TEAM_SLUGS = {
    "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e", "ksb-f", "ksb-g",
    "ksb-h", "ksb-juniors", "ksb-juniors-1", "ksb-juniors-2",
    "ksb-juniors-3", "ksb-juniors-4", "ksb-lions", "ksb-tigers-jun",
    "ksb-jaguars", "ksb-pumas-jun", "ksb-leopards-jun",
    "ksb-panthers-jun"
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def get_json(url, timeout):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KSB-Opposition-Database/2.0",
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


def blank_stats():
    return {
        "played": 0, "wins": 0, "draws": 0, "losses": 0,
        "winPercentage": 0, "setsWon": 0, "setsLost": 0, "setDifference": 0,
    }


def add_result(stats, result, player_score, opponent_score):
    stats["played"] += 1
    if result == "W": stats["wins"] += 1
    elif result == "D": stats["draws"] += 1
    elif result == "L": stats["losses"] += 1
    stats["setsWon"] += int(player_score or 0)
    stats["setsLost"] += int(opponent_score or 0)


def finish_stats(stats):
    stats["winPercentage"] = round((stats["wins"] / stats["played"]) * 100, 2) if stats["played"] else 0
    stats["setDifference"] = stats["setsWon"] - stats["setsLost"]
    return stats


def extract_ksb_encounters(master):
    """Return every individual encounter from KSB player seasons, deduped by ID."""
    rows = {}
    players = master.get("players", {})
    for ksb_slug, player in players.items():
        ksb_name = player.get("name")
        for season_key, season_record in (player.get("seasons") or {}).items():
            season = int(season_record.get("season") or season_key)
            ksb_team = season_record.get("team") or {}
            for e in (season_record.get("statistics") or {}).get("encounters") or []:
                opponent_slug = e.get("opponentSlug")
                if not opponent_slug or opponent_slug in KSB_TEAM_SLUGS:
                    continue
                # The same encounter can occur in both players' records only if
                # both sides are KSB, so ID is sufficient for the non-KSB case.
                eid = e.get("id")
                key = f"{season}:{eid}" if eid is not None else (
                    f"{season}:{ksb_slug}:{opponent_slug}:{e.get('scoreLeft')}:{e.get('scoreRight')}"
                )
                if key not in rows:
                    rows[key] = {
                        "id": eid,
                        "season": season,
                        "ksbPlayer": ksb_name,
                        "ksbPlayerSlug": ksb_slug,
                        "ksbTeam": ksb_team.get("name"),
                        "ksbTeamSlug": ksb_team.get("slug"),
                        "scoreLeft": e.get("scoreLeft"),
                        "scoreRight": e.get("scoreRight"),
                        "playerLeftName": e.get("playerLeftName"),
                        "playerLeftSlug": e.get("playerLeftSlug"),
                        "playerRightName": e.get("playerRightName"),
                        "playerRightSlug": e.get("playerRightSlug"),
                        "playerRankChangeLeft": e.get("playerRankChangeLeft"),
                        "playerRankChangeRight": e.get("playerRankChangeRight"),
                        "ksbPlayerScore": e.get("playerScore"),
                        "opponentScore": e.get("opponentScore"),
                        "resultForKSBPlayer": e.get("result"),
                        "opponent": e.get("opponent"),
                        "opponentSlug": opponent_slug,
                    }
    return list(rows.values())


def build_seed(master, existing=None):
    encounters = extract_ksb_encounters(master)
    players = {}
    for e in encounters:
        slug = e["opponentSlug"]
        p = players.setdefault(slug, {
            "name": e.get("opponent"),
            "slug": slug,
            "firstKnownKSBSeason": e["season"],
            "lastKnownKSBSeason": e["season"],
            "teamHistory": [],
            "ksbSeasons": [],
            "ksbCareer": blank_stats(),
            "ksbBySeason": {},
            "ksbByTeam": {},
            "ksbEncounters": [],
            "apiStatus": "pending",
        })
        p["name"] = p["name"] or e.get("opponent")
        p["firstKnownKSBSeason"] = min(p["firstKnownKSBSeason"], e["season"])
        p["lastKnownKSBSeason"] = max(p["lastKnownKSBSeason"], e["season"])
        p["ksbEncounters"].append(e)

    # Preserve successful enrichment from an existing DB, if present.
    if existing:
        for slug, old in (existing.get("players") or {}).items():
            if slug in players:
                for key in ("teamHistory", "apiStatus", "api", "oppositionLeagueSeasons"):
                    if key in old:
                        players[slug][key] = old[key]

    for p in players.values():
        p["ksbSeasons"] = sorted({e["season"] for e in p["ksbEncounters"]})
        for e in p["ksbEncounters"]:
            season = str(e["season"])
            s = p["ksbBySeason"].setdefault(season, blank_stats())
            add_result(s, e["resultForKSBPlayer"], e["ksbPlayerScore"], e["opponentScore"])
            team_slug = e.get("ksbTeamSlug") or "unknown"
            team_name = e.get("ksbTeam") or team_slug
            t = p["ksbByTeam"].setdefault(team_slug, {"name": team_name, "slug": team_slug, **blank_stats()})
            add_result(t, e["resultForKSBPlayer"], e["ksbPlayerScore"], e["opponentScore"])
        for s in p["ksbBySeason"].values(): finish_stats(s)
        for t in p["ksbByTeam"].values(): finish_stats(t)
        p["ksbCareer"] = blank_stats()
        for e in p["ksbEncounters"]:
            add_result(p["ksbCareer"], e["resultForKSBPlayer"], e["ksbPlayerScore"], e["opponentScore"])
        finish_stats(p["ksbCareer"])
        p["ksbByTeam"] = dict(sorted(p["ksbByTeam"].items(), key=lambda x: x[1]["name"].lower()))
        p["ksbBySeason"] = dict(sorted(p["ksbBySeason"].items(), key=lambda x: int(x[0])))

    return players


def enrich_player_season(data, season, slug):
    p = data.get("player") or {}
    team = {
        "id": p.get("teamId"),
        "name": p.get("teamName"),
        "slug": p.get("teamSlug"),
        "divisionId": p.get("divisionId"),
        "division": p.get("division") or p.get("divisionName"),
        "rank": p.get("rank"),
    }
    return {
        "season": season,
        "player": {"id": p.get("id"), "name": p.get("name"), "slug": p.get("slug") or slug, "rank": p.get("rank")},
        "team": team,
        "api": {"url": f"{BASE}/api/result/{season}/player/{slug}", "status": "success"},
    }


def attach_team_to_encounters(player):
    by_season = {int(x["season"]): x for x in player.get("teamHistory", [])}
    for e in player.get("ksbEncounters", []):
        rec = by_season.get(int(e["season"]))
        if rec:
            e["opponentTeam"] = rec.get("team")
            e["opponentDivision"] = rec.get("team", {}).get("division")
            e["opponentRank"] = rec.get("player", {}).get("rank")
        else:
            e["opponentTeam"] = None
            e["opponentDivision"] = None
            e["opponentRank"] = None


def rebuild_global_team_summaries(players):
    by_team = {}
    for p in players.values():
        for e in p.get("ksbEncounters", []):
            team = e.get("opponentTeam") or {}
            slug = team.get("slug")
            if not slug:
                continue
            rec = by_team.setdefault(slug, {
                "name": team.get("name") or slug,
                "slug": slug,
                "divisions": {},
                "seasons": {},
                "played": 0, "wins": 0, "draws": 0, "losses": 0,
                "setsWon": 0, "setsLost": 0,
                "ksbPlayers": {},
                "oppositionPlayers": {},
            })
            rec["played"] += 1
            r = e.get("resultForKSBPlayer")
            if r == "W": rec["wins"] += 1
            elif r == "D": rec["draws"] += 1
            elif r == "L": rec["losses"] += 1
            rec["setsWon"] += int(e.get("ksbPlayerScore") or 0)
            rec["setsLost"] += int(e.get("opponentScore") or 0)
            season = str(e["season"])
            rec["seasons"].setdefault(season, 0)
            rec["seasons"][season] += 1
            div = e.get("opponentDivision")
            if div:
                rec["divisions"][div] = rec["divisions"].get(div, 0) + 1
            kp = e.get("ksbPlayerSlug")
            kpn = e.get("ksbPlayer")
            op = e.get("opponentSlug")
            opn = e.get("opponent")
            if kp:
                rec["ksbPlayers"].setdefault(kp, {"name": kpn, **blank_stats()})
                add_result(rec["ksbPlayers"][kp], r, e.get("ksbPlayerScore"), e.get("opponentScore"))
            if op:
                rec["oppositionPlayers"].setdefault(op, {"name": opn, **blank_stats()})
                # From KSB's perspective this is a result against the player.
                add_result(rec["oppositionPlayers"][op], r, e.get("ksbPlayerScore"), e.get("opponentScore"))
    for rec in by_team.values():
        rec["winPercentage"] = round(rec["wins"] / rec["played"] * 100, 2) if rec["played"] else 0
        rec["setDifference"] = rec["setsWon"] - rec["setsLost"]
        for x in rec["ksbPlayers"].values(): finish_stats(x)
        for x in rec["oppositionPlayers"].values(): finish_stats(x)
        rec["ksbPlayers"] = dict(sorted(rec["ksbPlayers"].items(), key=lambda x: x[1]["name"].lower()))
        rec["oppositionPlayers"] = dict(sorted(rec["oppositionPlayers"].items(), key=lambda x: x[1]["name"].lower()))
    return dict(sorted(by_team.items(), key=lambda x: x[1]["name"].lower()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", default=DEFAULT_MASTER)
    ap.add_argument("--output", default=DEFAULT_OUTPUT)
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    master_path = Path(args.master)
    output_path = Path(args.output)
    cache_path = Path(args.cache)
    if not master_path.exists():
        raise SystemExit(f"Could not find {master_path}")

    master = json.loads(master_path.read_text(encoding="utf-8"))
    existing = None
    if output_path.exists():
        try: existing = json.loads(output_path.read_text(encoding="utf-8"))
        except Exception: existing = None
    players = build_seed(master, existing)

    cache = {}
    if cache_path.exists() and not args.refresh:
        try: cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception: cache = {}

    requests = []
    for slug, p in sorted(players.items()):
        for season in p["ksbSeasons"]:
            key = f"{season}:{slug}"
            if not args.refresh and cache.get(key, {}).get("status") == "success":
                continue
            requests.append((season, slug, key))

    print(f"Opposition players: {len(players)}")
    print(f"Season/player API lookups required: {len(requests)}")

    successful = failed = 0
    for i, (season, slug, key) in enumerate(requests, 1):
        url = f"{BASE}/api/result/{season}/player/{slug}"
        result = safe_get(url, args.timeout)
        if result["status"] == "success":
            rec = enrich_player_season(result["data"], season, slug)
            p = players[slug]
            p.setdefault("teamHistory", [])
            p["teamHistory"] = [x for x in p["teamHistory"] if int(x.get("season")) != season]
            p["teamHistory"].append(rec)
            p["teamHistory"].sort(key=lambda x: int(x["season"]))
            p["apiStatus"] = "success"
            cache[key] = rec["api"]
            successful += 1
        else:
            cache[key] = {"url": url, "status": result["status"], "error": result["error"]}
            # Keep player pending if any season is unresolved.
            p = players[slug]
            if p.get("apiStatus") != "success": p["apiStatus"] = "partial"
            failed += 1
        if i % 25 == 0 or i == len(requests):
            print(f"  [{i}/{len(requests)}] complete; success={successful}, failed={failed}")
        time.sleep(max(0, args.delay))

    # Directly attach the opposition team to every individual KSB encounter.
    for p in players.values():
        attach_team_to_encounters(p)
        p["teamHistoryComplete"] = all(
            any(int(t.get("season")) == s for t in p.get("teamHistory", []))
            for s in p.get("ksbSeasons", [])
        )
        if p["teamHistoryComplete"]: p["apiStatus"] = "success"

    team_summaries = rebuild_global_team_summaries(players)

    coverage = master.get("coverage", {})
    output = {
        "schemaVersion": 2,
        "databaseType": "KSB Opposition Database",
        "description": "Non-KSB players who have faced KSB, enriched with the opposition player's team/division/rank for each season.",
        "club": master.get("club", {"name": "Kay Street Baptist Church", "shortName": "KSB"}),
        "source": {
            "website": BASE,
            "playerApiTemplate": f"{BASE}/api/result/{{season}}/player/{{playerSlug}}",
            "derivedFrom": "ksb_master_database.json",
        },
        "dataModel": {
            "players": "Only non-KSB players who have appeared in KSB individual encounters.",
            "teamHistory": "One record per season showing the opposition player's team, division and rank.",
            "ksbEncounters": "Existing KSB-v-opponent individual matches, with opponent team attached where enriched.",
            "ksbByTeam": "KSB player's record against each KSB team.",
            "oppositionTeams": "Global team-level summaries derived from enriched individual encounters.",
            "note": "Team-level statistics are derived from individual encounters, so they count only actual player matches, not team fixture scores.",
        },
        "coverage": {
            "historicStartSeason": coverage.get("historicStartSeason"),
            "historicEndSeason": coverage.get("historicEndSeason"),
            "currentSeason": coverage.get("currentSeason"),
            "oppositionPlayerCount": len(players),
            "oppositionTeamCount": len(team_summaries),
            "ksbEncounterCount": sum(len(p["ksbEncounters"]) for p in players.values()),
            "enrichedEncounterCount": sum(
                1 for p in players.values() for e in p["ksbEncounters"] if e.get("opponentTeam")
            ),
            "successfulApiLookupsThisRun": successful,
            "failedApiLookupsThisRun": failed,
            "lastUpdated": utc_now(),
        },
        "players": dict(sorted(players.items(), key=lambda x: x[1]["name"].lower())),
        "oppositionTeams": team_summaries,
        "provenance": {
            "generatedAt": utc_now(),
            "ksbMasterDatabase": str(master_path),
            "api": BASE,
        },
    }

    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\nDone.")
    print(f"Output: {output_path}")
    print(f"Opposition players: {len(players)}")
    print(f"Opposition teams enriched: {len(team_summaries)}")
    print(f"KSB encounters: {output['coverage']['ksbEncounterCount']}")
    print(f"Enriched encounters: {output['coverage']['enrichedEncounterCount']}")
    print(f"Successful lookups this run: {successful}")
    print(f"Failed lookups this run: {failed}")


if __name__ == "__main__":
    main()

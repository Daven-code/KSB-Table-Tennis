import json
import time
import requests
from pathlib import Path
from datetime import datetime


# ============================================================
# SETTINGS
# ============================================================

START_SEASON = 2013
END_SEASON = 2026

# Existing file containing the KSB player list and seasons
PLAYER_FILE = "player-data.json"

# Output file
OUTPUT_FILE = "ksb_individual_history.json"

# API
API_TEMPLATE = "https://eastlancstt.org.uk/api/result/{season}/player/{slug}"

# Small delay between requests so we don't hammer the server
REQUEST_DELAY = 0.15

# Number of retries if a request temporarily fails
MAX_RETRIES = 3

# Timeout for each API request
TIMEOUT = 20


# ============================================================
# LOAD PLAYER LIST
# ============================================================

print()
print("=" * 70)
print("KSB INDIVIDUAL PLAYER DATA DOWNLOADER")
print("=" * 70)
print()

player_file_path = Path(PLAYER_FILE)

if not player_file_path.exists():
    print(f"ERROR: Could not find {PLAYER_FILE}")
    print()
    print("Make sure this script is in the same folder as:")
    print(f"  {PLAYER_FILE}")
    print()
    input("Press Enter to exit...")
    raise SystemExit


with open(player_file_path, "r", encoding="utf-8") as f:
    player_data = json.load(f)


players = player_data.get("players", [])

print(f"Found {len(players)} KSB players in {PLAYER_FILE}")
print()


# ============================================================
# BUILD PLAYER/SEASON LIST
# ============================================================

player_seasons = []

for player in players:

    name = player.get("name")
    slug = player.get("slug")

    if not name or not slug:
        continue

    # Prefer the actual seasons listed for the player
    seasons = player.get("seasons", [])

    if seasons:
        for season_info in seasons:

            season = season_info.get("season")

            if season is None:
                continue

            if START_SEASON <= int(season) <= END_SEASON:

                player_seasons.append({
                    "season": int(season),
                    "name": name,
                    "slug": slug,
                    "team": season_info.get("team"),
                    "teamSlug": season_info.get("teamSlug"),
                    "division": season_info.get("division"),
                    "rankFromRoster": season_info.get("rank")
                })

    else:

        # Fallback if a player has no season information
        first = player.get("firstSeason")
        last = player.get("lastSeason")

        if first and last:

            for season in range(
                max(START_SEASON, int(first)),
                min(END_SEASON, int(last)) + 1
            ):

                player_seasons.append({
                    "season": season,
                    "name": name,
                    "slug": slug,
                    "team": None,
                    "teamSlug": None,
                    "division": None,
                    "rankFromRoster": None
                })


# Remove duplicates
unique_player_seasons = {}

for item in player_seasons:

    key = (
        item["season"],
        item["slug"]
    )

    unique_player_seasons[key] = item


player_seasons = list(unique_player_seasons.values())

player_seasons.sort(
    key=lambda x: (
        x["season"],
        x["name"].lower()
    )
)


print(
    f"Found {len(player_seasons)} player-season combinations "
    f"to investigate."
)
print()


# ============================================================
# SESSION
# ============================================================

session = requests.Session()

session.headers.update({
    "User-Agent": "KSB Table Tennis Historical Data Research"
})


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def clean_player_data(data):
    """
    Remove unnecessary/private contact information from the API response.

    The API includes phoneMobile / phoneLandline.
    These aren't needed for player statistics, so they are deliberately
    excluded from the historical statistics JSON.
    """

    if not isinstance(data, dict):
        return data

    cleaned = {}

    for key, value in data.items():

        if key in (
            "phoneMobile",
            "phoneLandline"
        ):
            continue

        cleaned[key] = value

    return cleaned


def calculate_player_statistics(encounters, player_name, player_slug):

    wins = 0
    losses = 0
    draws = 0

    sets_won = 0
    sets_lost = 0

    opponents = {}

    cleaned_encounters = []

    for encounter in encounters:

        left_name = encounter.get("playerLeftName")
        left_slug = encounter.get("playerLeftSlug")

        right_name = encounter.get("playerRightName")
        right_slug = encounter.get("playerRightSlug")

        left_score = encounter.get("scoreLeft")
        right_score = encounter.get("scoreRight")

        # ----------------------------------------------------
        # Determine which side the KSB player is on
        # ----------------------------------------------------

        if left_slug == player_slug:

            opponent_name = right_name
            opponent_slug = right_slug

            player_score = left_score
            opponent_score = right_score

        elif right_slug == player_slug:

            opponent_name = left_name
            opponent_slug = left_slug

            player_score = right_score
            opponent_score = left_score

        else:

            # Fallback to names in case the slug differs
            if left_name == player_name:

                opponent_name = right_name
                opponent_slug = right_slug

                player_score = left_score
                opponent_score = right_score

            elif right_name == player_name:

                opponent_name = left_name
                opponent_slug = left_slug

                player_score = right_score
                opponent_score = left_score

            else:

                # This encounter doesn't appear to involve
                # the player we're processing.
                continue

        # ----------------------------------------------------
        # Validate scores
        # ----------------------------------------------------

        if player_score is None or opponent_score is None:
            continue

        # ----------------------------------------------------
        # Result
        # ----------------------------------------------------

        if player_score > opponent_score:
            result = "W"
            wins += 1

        elif player_score < opponent_score:
            result = "L"
            losses += 1

        else:
            result = "D"
            draws += 1

        # ----------------------------------------------------
        # Sets
        # ----------------------------------------------------

        sets_won += player_score
        sets_lost += opponent_score

        # ----------------------------------------------------
        # Opponent record
        # ----------------------------------------------------

        opponent_key = opponent_slug or opponent_name

        if opponent_key not in opponents:

            opponents[opponent_key] = {
                "name": opponent_name,
                "slug": opponent_slug,
                "played": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0
            }

        opponent_record = opponents[opponent_key]

        opponent_record["played"] += 1

        if result == "W":
            opponent_record["wins"] += 1

        elif result == "D":
            opponent_record["draws"] += 1

        else:
            opponent_record["losses"] += 1

        # ----------------------------------------------------
        # Store cleaned individual encounter
        # ----------------------------------------------------

        encounter_copy = dict(encounter)

        encounter_copy["player"] = player_name
        encounter_copy["playerSlug"] = player_slug

        encounter_copy["opponent"] = opponent_name
        encounter_copy["opponentSlug"] = opponent_slug

        encounter_copy["playerScore"] = player_score
        encounter_copy["opponentScore"] = opponent_score

        encounter_copy["result"] = result

        cleaned_encounters.append(encounter_copy)

    # --------------------------------------------------------
    # Win percentage
    # --------------------------------------------------------

    played = wins + draws + losses

    if played > 0:
        win_percentage = round((wins / played) * 100, 2)
    else:
        win_percentage = 0

    # --------------------------------------------------------
    # Opponent percentages
    # --------------------------------------------------------

    for opponent in opponents.values():

        played_against = opponent["played"]

        if played_against > 0:

            opponent["winPercentage"] = round(
                (opponent["wins"] / played_against) * 100,
                2
            )

        else:

            opponent["winPercentage"] = 0

    return {
        "played": played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "winPercentage": win_percentage,
        "setsWon": sets_won,
        "setsLost": sets_lost,
        "setDifference": sets_won - sets_lost,
        "opponents": sorted(
            opponents.values(),
            key=lambda x: x["name"].lower()
        ),
        "encounters": cleaned_encounters
    }


# ============================================================
# DOWNLOAD DATA
# ============================================================

results = []

successful = 0
not_found = 0
failed = 0

total = len(player_seasons)


for index, player_season in enumerate(player_seasons, start=1):

    season = player_season["season"]
    name = player_season["name"]
    slug = player_season["slug"]

    url = API_TEMPLATE.format(
        season=season,
        slug=slug
    )

    print(
        f"[{index}/{total}] "
        f"{season} - {name}"
    )

    response_data = None
    error_message = None

    # --------------------------------------------------------
    # Try request
    # --------------------------------------------------------

    for attempt in range(1, MAX_RETRIES + 1):

        try:

            response = session.get(
                url,
                timeout=TIMEOUT
            )

            if response.status_code == 200:

                response_data = response.json()
                break

            elif response.status_code == 404:

                error_message = "404 - player/season not found"
                break

            else:

                error_message = (
                    f"HTTP {response.status_code}"
                )

        except requests.RequestException as e:

            error_message = str(e)

        if attempt < MAX_RETRIES:

            time.sleep(1)


    # --------------------------------------------------------
    # Process successful result
    # --------------------------------------------------------

    if response_data is not None:

        successful += 1

        api_player = response_data.get(
            "player",
            {}
        )

        encounters = response_data.get(
            "encounters",
            []
        )

        fixtures = response_data.get(
            "fixtures",
            []
        )

        weeks = response_data.get(
            "weeks",
            []
        )

        statistics = calculate_player_statistics(
            encounters,
            name,
            slug
        )

        player_record = {

            "season": season,

            "player": {
                "id": api_player.get("id"),
                "name": api_player.get(
                    "name",
                    name
                ),
                "slug": api_player.get(
                    "slug",
                    slug
                ),
                "rank": api_player.get(
                    "rank"
                )
            },

            "team": {
                "name": api_player.get(
                    "teamName",
                    player_season.get("team")
                ),
                "slug": api_player.get(
                    "teamSlug",
                    player_season.get("teamSlug")
                ),
                "divisionId": api_player.get(
                    "divisionId"
                ),
                "division": player_season.get(
                    "division"
                )
            },

            "statistics": statistics,

            "fixtures": fixtures,

            "weeks": weeks,

            "api": {
                "url": url,
                "status": "success"
            }
        }

        results.append(player_record)

        print(
            f"    ✓ {len(encounters)} individual encounters"
        )

    else:

        if error_message and error_message.startswith("404"):

            not_found += 1

            print(
                "    - No data returned for this "
                "player/season"
            )

        else:

            failed += 1

            print(
                f"    ! Failed: {error_message}"
            )

        # Still record the attempted URL so we know
        # which player/season could not be retrieved.

        results.append({

            "season": season,

            "player": {
                "name": name,
                "slug": slug
            },

            "team": {
                "name": player_season.get("team"),
                "slug": player_season.get("teamSlug"),
                "division": player_season.get("division")
            },

            "statistics": None,

            "fixtures": [],
            "weeks": [],

            "api": {
                "url": url,
                "status": "not_found"
                if error_message
                and error_message.startswith("404")
                else "error",
                "error": error_message
            }
        })

    # --------------------------------------------------------
    # Delay
    # --------------------------------------------------------

    time.sleep(REQUEST_DELAY)


# ============================================================
# CREATE PLAYER-CENTRIC VERSION
# ============================================================

players_output = {}

for record in results:

    player = record["player"]

    slug = player["slug"]

    if slug not in players_output:

        players_output[slug] = {

            "name": player.get("name"),

            "slug": slug,

            "seasons": [],

            "career": {

                "played": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "setsWon": 0,
                "setsLost": 0
            }
        }

    player_output = players_output[slug]

    player_output["seasons"].append(record)

    statistics = record.get("statistics")

    if statistics:

        career = player_output["career"]

        career["played"] += statistics["played"]
        career["wins"] += statistics["wins"]
        career["draws"] += statistics["draws"]
        career["losses"] += statistics["losses"]
        career["setsWon"] += statistics["setsWon"]
        career["setsLost"] += statistics["setsLost"]


# ============================================================
# CALCULATE CAREER WIN %
# ============================================================

for player in players_output.values():

    career = player["career"]

    played = career["played"]

    if played > 0:

        career["winPercentage"] = round(
            (career["wins"] / played) * 100,
            2
        )

    else:

        career["winPercentage"] = 0

    career["setDifference"] = (
        career["setsWon"]
        -
        career["setsLost"]
    )


# ============================================================
# FINAL JSON
# ============================================================

output = {

    "schemaVersion": 1,

    "source": "https://eastlancstt.org.uk",

    "description": (
        "Historical and current individual KSB "
        "table tennis player data."
    ),

    "generatedAt": datetime.utcnow().isoformat() + "Z",

    "coverage": {
        "startSeason": START_SEASON,
        "endSeason": END_SEASON,
        "playersFound": len(players_output),
        "playerSeasonRequests": total,
        "successfulRequests": successful,
        "notFoundRequests": not_found,
        "failedRequests": failed
    },

    "apiTemplate": API_TEMPLATE,

    "players": list(
        sorted(
            players_output.values(),
            key=lambda x: x["name"].lower()
        )
    ),

    "playerSeasons": results
}


# ============================================================
# WRITE FILE
# ============================================================

with open(
    OUTPUT_FILE,
    "w",
    encoding="utf-8"
) as f:

    json.dump(
        output,
        f,
        indent=2,
        ensure_ascii=False
    )


# ============================================================
# FINISHED
# ============================================================

print()
print("=" * 70)
print("COMPLETE")
print("=" * 70)
print()

print(f"Output file:")
print(f"  {OUTPUT_FILE}")
print()

print(f"Players:")
print(f"  {len(players_output)}")

print()
print(f"Player-season requests:")
print(f"  {total}")

print()
print(f"Successful API requests:")
print(f"  {successful}")

print()
print(f"Not found:")
print(f"  {not_found}")

print()
print(f"Other failures:")
print(f"  {failed}")

print()
print("The JSON contains:")
print("  - Individual encounters")
print("  - Opponents")
print("  - Wins / losses / draws")
print("  - Win percentage")
print("  - Sets won / lost")
print("  - Head-to-head records")
print("  - Ranking changes")
print("  - Team")
print("  - Division")
print("  - Season")
print("  - Fixtures")
print("  - Weeks")
print("  - Career totals")
print()

print("=" * 70)
print()
input("Press Enter to exit...")
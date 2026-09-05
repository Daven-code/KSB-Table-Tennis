import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE_URL = "https://eastlancstt.org.uk/api/result"

OUTPUT_FILE = "ksb_history.json"

# ------------------------------------------------------------
# KSB TEAM ENDPOINTS
# ------------------------------------------------------------

teams_by_season = {
    2013: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e", "ksb-f"
    ],

    2014: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e"
    ],

    2015: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e"
    ],

    2016: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d"
    ],

    2017: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e", "ksb-f"
    ],

    2018: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f", "ksb-g"
    ],

    2019: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f", "ksb-g",
        "ksb-juniors"
    ],

    # 2020 is not present in the league archive.

    2021: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d", "ksb-e",
        "ksb-juniors-1", "ksb-juniors-2"
    ],

    2022: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f",
        "ksb-juniors-1", "ksb-juniors-2"
    ],

    2023: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f", "ksb-g",
        "ksb-juniors-1", "ksb-juniors-2", "ksb-juniors-3"
    ],

    2024: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f", "ksb-g", "ksb-h",
        "ksb-juniors-1", "ksb-juniors-2",
        "ksb-juniors-3", "ksb-juniors-4"
    ],

    2025: [
        "ksb-a", "ksb-b", "ksb-c", "ksb-d",
        "ksb-e", "ksb-f",
        "ksb-lions",
        "ksb-tigers-jun",
        "ksb-g",
        "ksb-jaguars",
        "ksb-pumas-jun",
        "ksb-leopards-jun",
        "ksb-panthers-jun"
    ],

    # 2026 endpoints can be added once the season has data.
}


# ------------------------------------------------------------
# DOWNLOAD FUNCTION
# ------------------------------------------------------------

def download_json(url):
    """
    Download JSON from an API endpoint.
    """

    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0"
        }
    )

    try:
        with urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8")

        return json.loads(data)

    except HTTPError as e:
        print(f"HTTP ERROR {e.code}: {url}")
        return None

    except URLError as e:
        print(f"URL ERROR: {e.reason}: {url}")
        return None

    except json.JSONDecodeError:
        print(f"INVALID JSON: {url}")
        return None

    except Exception as e:
        print(f"ERROR: {e}: {url}")
        return None


# ------------------------------------------------------------
# MAIN DOWNLOAD
# ------------------------------------------------------------

def main():

    print()
    print("=" * 70)
    print(" EAST LANCS KSB HISTORICAL DATA DOWNLOADER")
    print("=" * 70)
    print()

    output = {
        "source": "https://eastlancstt.org.uk",
        "description": "Historical KSB team data from East Lancs Table Tennis API",
        "downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seasons": {},
        "player_stats": {}
    }

    total = sum(len(teams) for teams in teams_by_season.values())

    completed = 0

    print(f"Endpoints to download: {total}")
    print()

    # --------------------------------------------------------
    # DOWNLOAD EVERY TEAM
    # --------------------------------------------------------

    for season, teams in teams_by_season.items():

        season_key = str(season)

        output["seasons"][season_key] = {}

        print(f"\nSEASON {season}")
        print("-" * 50)

        for team in teams:

            completed += 1

            url = f"{BASE_URL}/{season}/team/{team}"

            print(
                f"[{completed}/{total}] "
                f"{season} / {team}"
            )

            data = download_json(url)

            if data is None:

                output["seasons"][season_key][team] = {
                    "url": url,
                    "status": "error",
                    "data": None
                }

            else:

                output["seasons"][season_key][team] = {
                    "url": url,
                    "status": "success",
                    "data": data
                }

            # Don't hammer the server
            time.sleep(0.25)

    # --------------------------------------------------------
    # SAVE RAW DATA
    # --------------------------------------------------------

    print()
    print("Saving raw API data...")

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

    print()
    print("=" * 70)
    print(" DOWNLOAD COMPLETE")
    print("=" * 70)
    print()
    print(f"File created: {OUTPUT_FILE}")
    print()


if __name__ == "__main__":
    main()

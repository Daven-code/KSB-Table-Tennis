# KSB Table Tennis Master Database

## Files

- `ksb_master_database.json` — the single database used by the website.
- `update_ksb_database.py` — refreshes the live/current season from the East Lancs TT API.

## Current design

- Historic layer: 2013–2025 (stored locally).
- Current live layer: 2026.
- `players[*].historic` = historic statistics only.
- `players[*].currentSeason` = current-season statistics only.
- `players[*].career` = historic + current-season statistics.
- `players[*].seasons` = season-by-season player records.
- `currentSeason.teams` = live team/fixture data.
- `currentSeason.encounters` = live individual matches.

## First use

Put both files in the same folder and run:

    python update_ksb_database.py

The script uses only Python's standard library, so no `pip install` is required.

## Refresh during a season

Run the same command again:

    python update_ksb_database.py

It re-fetches the current season and recalculates current/career statistics. Historic data is left untouched.

## Starting a new season

When the league moves from 2026 to the next season:

1. Make a deliberate archive decision for the completed season.
2. Change `HISTORIC_END_SEASON` in `update_ksb_database.py` to 2026.
3. Change `CURRENT_SEASON` to the new season number.
4. Run the script.

This keeps the completed season in the historic layer and makes the new season the live layer.

## Useful website fields

For a player:

- `players["player-slug"]["historic"]`
- `players["player-slug"]["currentSeason"]`
- `players["player-slug"]["career"]`
- `players["player-slug"]["seasons"]["2026"]`

For live team information:

- `currentSeason.teams`

For individual live matches:

- `currentSeason.encounters`

## Data source

East Lancashire Table Tennis:
https://eastlancstt.org.uk

Player API pattern:
https://eastlancstt.org.uk/api/result/{season}/player/{playerSlug}

Team API pattern:
https://eastlancstt.org.uk/api/result/{season}/team/{teamSlug}

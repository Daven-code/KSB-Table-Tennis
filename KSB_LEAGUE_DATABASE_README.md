# KSB league database

## Authoritative files

- `league_database.json`: all league teams, players, standings and individual encounters.
- `update_league_database.py`: the only script that builds or refreshes the full league database.
- `ksb_master_database.json`: retained for KSB-only archive pages and club insights.
- `ksb_opposition_database.json`: retained for KSB opposition analytics only.

## First clean build

Run once after installing this update:

```powershell
python update_league_database.py --mode bootstrap --start 2013 --season 2026
```

This is required because older copies of `league_database.json` contain historic team rosters but do not contain a complete historic `playerSeasons` index.

## Normal updates

```powershell
python update_league_database.py --mode incremental
```

Only the active season is downloaded. Historical seasons remain unchanged. The active season changes from 2026 to 2027 on 1 September 2027.

## Files no longer used

After testing, remove:

- `league-directory.js`
- `download_ksb_data.py`
- `download_ksb_individual_data.py`
- old update ZIP files

Do not remove the JSON databases, photographs, CSVs or Excel workbooks.

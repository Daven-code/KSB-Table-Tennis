#!/usr/bin/env python3
"""Maintain the complete East Lancashire TT database with immutable history.

Bootstrap mode downloads every season from --start through the active season.
Incremental mode preserves all earlier seasons and replaces only the active
season. The active season changes on 1 September, unless --season is supplied.
"""
import argparse, json, time, urllib.error, urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://eastlancstt.org.uk/api/result"
DIVISIONS = ("premier", "first", "second", "third")

def utc_now(): return datetime.now(timezone.utc).isoformat()
def automatic_season(today=None):
    today = today or date.today()
    return today.year if today.month >= 9 else today.year - 1

def get_json(url, timeout, attempts, delay):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (compatible; KSB-League-Database/2.0)","Accept":"application/json","Cache-Control":"no-cache"})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8")), None
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if exc.code == 404: return exc.code, None, last
        except Exception as exc: last = str(exc)
        if attempt < attempts: time.sleep(delay * attempt)
    return 0, None, last

def calculate_stats(encounters, slug, name, player_directory):
    wins=losses=draws=sets_won=sets_lost=0; clean=[]
    for row in encounters or []:
        left=row.get("playerLeftSlug")==slug or row.get("playerLeftName")==name
        right=row.get("playerRightSlug")==slug or row.get("playerRightName")==name
        if not left and not right: continue
        ps=row.get("scoreLeft") if left else row.get("scoreRight"); os=row.get("scoreRight") if left else row.get("scoreLeft")
        if ps is None or os is None: continue
        result="W" if ps>os else "L" if ps<os else "D"
        wins+=result=="W"; losses+=result=="L"; draws+=result=="D"; sets_won+=int(ps); sets_lost+=int(os)
        opponent_name = row.get("playerRightName") if left else row.get("playerLeftName")
        opponent_slug = row.get("playerRightSlug") if left else row.get("playerLeftSlug")
        opponent_context = player_directory.get(opponent_slug) or {}
        opponent_team = opponent_context.get("team") or {}
        item=dict(row); item.update({"player":name,"playerSlug":slug,"opponent":opponent_name,"opponentSlug":opponent_slug,"opponentTeam":{"id":opponent_team.get("id"),"name":opponent_team.get("name"),"slug":opponent_team.get("slug"),"division":opponent_context.get("division")},"playerScore":ps,"opponentScore":os,"setsPercentage":round(int(ps)*100/(int(ps)+int(os)),2) if int(ps)+int(os) else 0,"result":result}); clean.append(item)
    played=wins+losses+draws
    return {"played":played,"wins":wins,"draws":draws,"losses":losses,"winPercentage":round(wins*100/played,2) if played else 0,"setsWon":sets_won,"setsLost":sets_lost,"setsPercentage":round(sets_won*100/(sets_won+sets_lost),2) if sets_won+sets_lost else 0,"setDifference":sets_won-sets_lost,"encounters":clean}

def fetch_season(season, args, errors):
    season_data={"divisions":{},"teams":{}}; player_jobs={}
    for division in DIVISIONS:
        url=f"{BASE}/{season}/{division}/league"; status,rows,error=get_json(url,args.timeout,args.attempts,args.delay)
        if status==404: continue
        if not isinstance(rows,list): errors.append({"url":url,"error":error or "Invalid league response"}); continue
        season_data["divisions"][division]=rows
        for entry in rows:
            team=entry.get("team") or {}; slug=team.get("slug")
            if not slug or slug in season_data["teams"]: continue
            team_url=f"{BASE}/{season}/team/{slug}"; _,detail,team_error=get_json(team_url,args.timeout,args.attempts,args.delay)
            if not isinstance(detail,dict): errors.append({"url":team_url,"error":team_error or "Invalid team response"}); continue
            record={"season":season,"division":division,"team":detail.get("team") or team,"players":detail.get("players") or [],"fixtures":detail.get("fixtures") or [],"weeks":detail.get("weeks") or []}
            season_data["teams"][slug]=record
            for player in record["players"]:
                if player.get("slug"): player_jobs[player["slug"]]={"name":player.get("name"),"team":record["team"],"division":division}
            time.sleep(args.delay)
    player_seasons={}
    jobs=sorted(player_jobs.items())
    for index,(slug,context) in enumerate(jobs,1):
        url=f"{BASE}/{season}/player/{slug}"; _,data,error=get_json(url,args.timeout,args.attempts,args.delay)
        if not isinstance(data,dict): errors.append({"url":url,"error":error or "Invalid player response"}); continue
        api=data.get("player") or {}; name=api.get("name") or context["name"] or slug; team=context["team"] or {}
        player_seasons[slug]={"name":name,"isKsb":str(team.get("slug","")).startswith("ksb"),"record":{"season":season,"player":{"id":api.get("id"),"name":name,"slug":slug,"rank":api.get("rank")},"team":{"id":team.get("id"),"name":team.get("name"),"slug":team.get("slug"),"division":context["division"]},"statistics":calculate_stats(data.get("encounters"),slug,name,player_jobs)}}
        if index%100==0 or index==len(jobs): print(f"{season} players: {index}/{len(jobs)}")
        time.sleep(args.delay)
    return season_data,player_seasons

def rebuild_indexes(db):
    db["teams"]={}; db["players"]={}
    for year,season in sorted(db.get("seasons",{}).items(),key=lambda x:int(x[0])):
        for slug,record in season.get("teams",{}).items():
            team=db["teams"].setdefault(slug,{"name":record.get("team",{}).get("name"),"slug":slug,"seasons":{}}); team["seasons"][year]=record
        for slug,payload in season.get("playerSeasons",{}).items():
            player=db["players"].setdefault(slug,{"name":payload["name"],"slug":slug,"isKsb":False,"seasons":{}}); player["name"]=payload["name"]; player["isKsb"]=player["isKsb"] or payload.get("isKsb",False); player["seasons"][year]=payload["record"]
    for player in db["players"].values():
        career={"played":0,"wins":0,"draws":0,"losses":0,"setsWon":0,"setsLost":0}
        for record in player["seasons"].values():
            st=record["statistics"]
            for key in career: career[key]+=int(st.get(key) or 0)
            opponents={}
            for match in st.get("encounters") or []:
                key=match.get("opponentSlug") or match.get("opponent"); row=opponents.setdefault(key,{"name":match.get("opponent"),"slug":match.get("opponentSlug"),"played":0,"wins":0,"draws":0,"losses":0}); row["played"]+=1; row["wins"]+=match["result"]=="W"; row["losses"]+=match["result"]=="L"; row["draws"]+=match["result"]=="D"
            for row in opponents.values(): row["winPercentage"]=round(row["wins"]*100/row["played"],2) if row["played"] else 0
            st["opponents"]=sorted(opponents.values(),key=lambda x:(x["name"] or "").lower())
        career["winPercentage"]=round(career["wins"]*100/career["played"],2) if career["played"] else 0; career["setDifference"]=career["setsWon"]-career["setsLost"]; player["career"]=career

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--mode",choices=("auto","bootstrap","incremental"),default="auto"); parser.add_argument("--start",type=int,default=2013); parser.add_argument("--season",type=int); parser.add_argument("--output",default="league_database.json"); parser.add_argument("--timeout",type=int,default=25); parser.add_argument("--attempts",type=int,default=4); parser.add_argument("--delay",type=float,default=.15); args=parser.parse_args()
    active=args.season or automatic_season(); path=Path(args.output); mode=args.mode
    if mode=="auto": mode="incremental" if path.exists() else "bootstrap"
    if mode=="incremental" and not path.exists(): raise SystemExit("Incremental mode requires an existing league_database.json. Run bootstrap once first.")
    checkpoint = path.with_name(path.stem + ".bootstrap-progress.json")
    if mode=="bootstrap":
        if checkpoint.exists():
            db=json.loads(checkpoint.read_text(encoding="utf-8"))
            db.setdefault("errors", [])
            completed=set(db.get("seasons", {}))
            print(f"Resuming bootstrap; {len(completed)} season(s) already saved in {checkpoint.name}.")
        else:
            db={"schemaVersion":2,"generatedAt":utc_now(),"source":BASE,"seasons":{},"teams":{},"players":{},"errors":[]}
            completed=set()
        years=[year for year in range(args.start,active+1) if str(year) not in completed]
    else:
        db=json.loads(path.read_text(encoding="utf-8")); db["errors"]=[]; years=[active]
    for season in years:
        print(f"Fetching season {season} ({mode})...")
        season_data,player_seasons=fetch_season(season,args,db["errors"])
        if not season_data["teams"]:
            if mode=="bootstrap" and season < active:
                print(f"No league season published for {season}; recording it as unavailable and continuing.")
                db.setdefault("unavailableSeasons", {})[str(season)]={"reason":"No team data returned by the league API","checkedAt":utc_now()}
            else:
                raise SystemExit(f"No team data returned for active season {season}; existing database was not overwritten.")
        else:
            season_data["playerSeasons"]=player_seasons
            db["seasons"][str(season)]=season_data
        if mode=="bootstrap":
            checkpoint.write_text(json.dumps(db,ensure_ascii=False,indent=2),encoding="utf-8")
            print(f"Saved bootstrap progress after {season}.")
    rebuild_indexes(db)
    db["generatedAt"]=utc_now()
    db["coverage"]={"startSeason":min(map(int,db["seasons"])),"currentSeason":active,"historicEndSeason":active-1,"seasonCount":len(db["seasons"]),"teamCount":len(db["teams"]),"playerCount":len(db["players"]),"errorCount":len(db["errors"]),"rolloverMonth":9}
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(db,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)
    if checkpoint.exists(): checkpoint.unlink()
    print(f"Wrote {path}; only {active} will refresh on future incremental runs.")
if __name__=="__main__": main()

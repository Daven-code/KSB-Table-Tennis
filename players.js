// KSB players and profiles. Single source of truth: ksb_master_database.json
const DB_FILE = "ksb_master_database.json";
const OPPOSITION_DB_FILE = "ksb_opposition_database.json";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
})[char]);

async function loadOppositionDatabase() {
  const response = await fetch(OPPOSITION_DB_FILE, { cache:"no-cache" });
  if (!response.ok) return { players:{}, oppositionTeams:{}, coverage:{} };
  return response.json();
}

async function loadDatabase() {
  const response = await fetch(DB_FILE, { cache:"no-cache" });
  if (!response.ok) throw new Error(`Could not load ${DB_FILE}.`);
  return response.json();
}

const seasonsOf = player => Object.values(player.seasons || {}).sort((a,b) => Number(a.season) - Number(b.season));
const seasonOf = (player, year) => player.seasons?.[String(year)];
const teamName = season => season?.team?.name || "";
const rankOf = season => season?.player?.rank ?? "-";
const stat = (season, key) => Number(season?.statistics?.[key] || 0);
const pct = (part, total) => total ? Math.round((part / total) * 10000) / 100 : 0;
const setPct = stats => pct(Number(stats?.setsWon || 0), Number(stats?.setsWon || 0) + Number(stats?.setsLost || 0));
const profileLink = player => `player.html?id=${encodeURIComponent(player.slug)}`;

function playerCards(players, year, current) {
  if (!players.length) return '<div class="ksb-player-empty">No matching players.</div>';
  return `<div class="ksb-player-grid">${players.map(player => {
    const season = current ? seasonOf(player, year) : seasonsOf(player).at(-1);
    return `<a class="ksb-player-card" href="${profileLink(player)}">
      <span class="ksb-player-main"><strong>${esc(player.name)}</strong><small>${current ? `${esc(teamName(season))} · ${year}` : `${seasonsOf(player)[0]?.season} to ${seasonsOf(player).at(-1)?.season}`}</small></span>
      <span class="ksb-rank-block"><strong>${esc(rankOf(season))}</strong><small>${current ? `${year} rank` : "Latest rank"}</small></span><span class="ksb-card-chevron">›</span>
    </a>`;
  }).join("")}</div>`;
}

function playerDirectory(host, players, year, current) {
  const teams = [...new Set(players.flatMap(player => current ? [teamName(seasonOf(player, year))] : seasonsOf(player).map(teamName)).filter(Boolean))].sort();
  host.className = "ksb-player-directory";
  host.innerHTML = `<div class="ksb-directory-controls"><label><span>Search player</span><input class="form-control" placeholder="Enter a player name"></label><label><span>Played for</span><select class="form-select"><option value="">All KSB teams</option>${teams.map(team => `<option>${esc(team)}</option>`).join("")}</select></label><output class="ksb-player-count"></output></div><div class="ksb-directory-results"></div>`;
  const query = host.querySelector("input"), team = host.querySelector("select"), count = host.querySelector("output"), results = host.querySelector(".ksb-directory-results");
  function draw() {
    let filtered = players.filter(player => (!query.value || player.name.toLowerCase().includes(query.value.toLowerCase())) && (!team.value || (current ? teamName(seasonOf(player, year)) === team.value : seasonsOf(player).some(season => teamName(season) === team.value))));
    filtered.sort(current ? (a,b) => Number(rankOf(seasonOf(b,year)) || 0) - Number(rankOf(seasonOf(a,year)) || 0) || a.name.localeCompare(b.name) : (a,b) => a.name.localeCompare(b.name));
    count.textContent = `${filtered.length} player${filtered.length === 1 ? "" : "s"}`;
    results.innerHTML = playerCards(filtered, year, current);
  }
  query.addEventListener("input", draw); team.addEventListener("change", draw); draw();
}

async function initPlayersPage() {
  const currentHost = document.getElementById("currentPlayersContent");
  if (!currentHost) return;
  const historicHost = document.getElementById("historicPlayersContent");
  try {
    const [database, opposition] = await Promise.all([loadDatabase(), loadOppositionDatabase()]);
    const year = Number(database.coverage?.currentSeason || 2026);
    const players = Object.values(database.players || {});
    const current = players.filter(player => seasonOf(player, year));
    playerDirectory(currentHost, current.length ? current : players.filter(player => seasonOf(player, database.coverage?.historicEndSeason)), current.length ? year : database.coverage?.historicEndSeason, true);
    playerDirectory(historicHost, players, year, false);
    const insightsHost = document.getElementById("clubInsightsContent");
    if (insightsHost) { insightsHost.className = ""; insightsHost.innerHTML = clubInsights(database, opposition); bindClubInsights(database, opposition); }
  } catch (error) {
    currentHost.className = historicHost.className = "status-panel error";
    currentHost.textContent = historicHost.textContent = error.message;
  }
}

function metricTiles(stats, includeRank, rank) {
  const totalSets = Number(stats?.setsWon || 0) + Number(stats?.setsLost || 0);
  const values = [
    ["Matches", stats?.played || 0], ["Wins", stats?.wins || 0], ["Losses", stats?.losses || 0],
    ["Match win %", `${stats?.winPercentage || 0}%`], ["Sets won", stats?.setsWon || 0],
    ["Sets lost", stats?.setsLost || 0], ["Sets won %", `${pct(stats?.setsWon || 0, totalSets)}%`]
  ];
  if (includeRank) values.unshift(["Rank", rank ?? "-"]);
  return `<div class="profile-metrics">${values.map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function resultBadge(result) { return `<span class="result-badge result-${String(result || "").toLowerCase()}">${esc(result || "-")}</span>`; }

function hasRecordedOpponent(record) {
  const name = String(record?.opponent ?? record?.name ?? "").trim();
  return Boolean(name && !["unknown opponent", "opponent not recorded", "unknown"].includes(name.toLowerCase()));
}

function opponentTeam(database, slug, season) {
  const opponent = database.players?.[slug];
  return teamName(seasonOf(opponent || {}, season)) || "Opponent not recorded";
}

function resultCards(encounters, database, season) {
  if (!encounters.length) return '<div class="ksb-player-empty">No individual results recorded for this season.</div>';
  return `<div class="scroll-card-list">${encounters.map(match => `<div class="mini-result-card"><div>${resultBadge(match.result)}<strong>${esc(hasRecordedOpponent(match) ? match.opponent : "Opponent not recorded")}</strong></div><span class="score-chip">${esc(match.playerScore)}-${esc(match.opponentScore)}</span></div>`).join("")}</div>`;
}

function opponentCards(opponents, database, season) {
  opponents = opponents.filter(hasRecordedOpponent);
  if (!opponents.length) return '<div class="ksb-player-empty">No opponent records available.</div>';
  return `<div class="scroll-card-list">${opponents.map(opponent => `<div class="mini-opponent-card"><div><strong>${esc(opponent.name)}</strong></div><div><b>${opponent.wins}-${opponent.losses}</b><small>${opponent.winPercentage}% wins</small></div></div>`).join("")}</div>`;
}

function seasonTable(seasons) {
  return `<div class="table-responsive"><table class="table table-dark table-striped align-middle player-history-table"><thead><tr><th>Season</th><th class="text-start">Team</th><th>Division</th><th>Rank</th><th>Played</th><th>Wins</th><th>Losses</th><th>Win %</th><th>Sets W-L</th><th>Sets won %</th></tr></thead><tbody>${[...seasons].reverse().map(season => `<tr><td>${season.season}</td><td class="text-start">${esc(teamName(season))}</td><td>${esc(season.team?.division || "-")}</td><td>${esc(rankOf(season))}</td><td>${stat(season,"played")}</td><td>${stat(season,"wins")}</td><td>${stat(season,"losses")}</td><td>${stat(season,"winPercentage")}%</td><td>${stat(season,"setsWon")}-${stat(season,"setsLost")}</td><td>${setPct(season.statistics)}%</td></tr>`).join("")}</tbody></table></div>`;
}

function teamContext(player, database, opposition) {
  const seasons = seasonsOf(player).filter(season => Number(season.season) <= Number(database.coverage?.historicEndSeason || 2025));
  const rows = seasons.map(season => {
    const storedTeam = database.historic?.seasons?.[String(season.season)]?.teams?.[season.team?.slug];
    const fixtures = (storedTeam?.fixtures || []).filter(fixture => fixture.scoreLeft != null && fixture.scoreRight != null);
    let won=0,drawn=0,lost=0;
    fixtures.forEach(fixture => { const left=fixture.teamLeftSlug===season.team?.slug; const ours=Number(left?fixture.scoreLeft:fixture.scoreRight), theirs=Number(left?fixture.scoreRight:fixture.scoreLeft); if(ours>theirs)won++; else if(ours===theirs)drawn++; else lost++; });
    return {season:season.season,team:teamName(season),division:season.team?.division||storedTeam?.team?.divisionName||"-",rank:rankOf(season),played:fixtures.length,wins:won,draws:drawn,losses:lost,winPercentage:pct(won,fixtures.length)};
  });
  return `<div class="profile-chart-grid"><section class="profile-panel"><h2>Ranking history</h2><div class="chart-box"><canvas id="teamRankChart"></canvas></div></section><section class="profile-panel"><h2>Team win rate by season</h2><div class="chart-box"><canvas id="teamRateChart"></canvas></div><p class="profile-help">Team results during seasons when this player appeared on the registered squad.</p></section></div><section class="profile-panel"><h2>Team season history</h2><div class="table-responsive"><table class="table table-dark table-striped align-middle player-history-table"><thead><tr><th>Season</th><th class="text-start">Team</th><th>Division</th><th>Rank</th><th>Team Played</th><th>Team Wins</th><th>Team Draws</th><th>Team Losses</th><th>Team Win %</th></tr></thead><tbody>${[...rows].reverse().map(row=>`<tr><td>${row.season}</td><td class="text-start">${esc(row.team)}</td><td>${esc(row.division)}</td><td>${row.rank}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.winPercentage}%</td></tr>`).join("")}</tbody></table></div></section>${playerClubPanel(player,opposition,"team-context")}`;
}

function pastSeasons(player, database) {
  const seasons = seasonsOf(player).filter(season => Number(season.season) <= Number(database.coverage?.historicEndSeason || 2025));
  const aggregate = player.historic || {};
  return `<div class="profile-subtabs"><button class="active" data-subtab="summary">Summary</button><button data-subtab="season">Season explorer</button></div>
    <section class="profile-subpanel active" data-subpanel="summary">${metricTiles(aggregate,false)}<div class="profile-chart-grid"><section class="profile-panel"><h2>Match win percentage</h2><div class="chart-box"><canvas id="individualWinChart"></canvas></div></section><section class="profile-panel"><h2>Sets won percentage</h2><div class="chart-box"><canvas id="setWinChart"></canvas></div></section></div><section class="profile-panel"><h2>Full season statistics</h2>${seasonTable(seasons)}</section></section>
    <section class="profile-subpanel" data-subpanel="season"><section class="profile-panel"><div class="season-browser"><div><h2>Explore a season</h2><p class="profile-help">Detailed individual statistics, opponent records and results.</p></div><select id="seasonSelect" class="form-select">${[...seasons].reverse().map(season => `<option>${season.season}</option>`).join("")}</select></div><div id="seasonDetail"></div></section></section>`;
}

function careerOpponentMap(player, database, opposition) {
  const map = new Map();
  seasonsOf(player).forEach(season => (season.statistics?.encounters || []).forEach(match => {
    if (!hasRecordedOpponent(match)) return;
    const key = match.opponentSlug || match.opponent;
    if (!key) return;
    const item = map.get(key) || {slug:match.opponentSlug,name:match.opponent,played:0,wins:0,losses:0,draws:0,setsWon:0,setsLost:0,teams:new Set(),matches:[]};
    item.played++; item.setsWon += Number(match.playerScore || 0); item.setsLost += Number(match.opponentScore || 0); item.matches.push({...match,season:season.season});
    if (match.result === "W") item.wins++; else if (match.result === "L") item.losses++; else item.draws++;
    const oppositionPlayer = opposition?.players?.[match.opponentSlug];
    (oppositionPlayer?.teamHistory || []).forEach(record => { if (record?.team?.name) item.teams.add(record.team.name); });
    map.set(key,item);
  }));
  return [...map.values()].map(item => ({...item,teams:[...item.teams],winPercentage:pct(item.wins,item.played),setPercentage:pct(item.setsWon,item.setsWon+item.setsLost)})).sort((a,b)=>a.name.localeCompare(b.name));
}

function careerLookup(player, database) {
  return `<section class="profile-panel"><div class="lookup-controls lookup-controls-single"><label><span>Opponent name</span><input id="careerOpponentSearch" class="form-control" placeholder="Type a player name"></label></div><div id="careerLookupResults"></div></section>`;
}

function clubInsightsBase(database) {
  const players = Object.values(database.players || {});
  const qualified = players.filter(player => Number(player.career?.played || 0) > 0);
  const mostMatches = [...qualified].sort((a,b)=>b.career.played-a.career.played).slice(0,10);
  const bestPct = [...qualified].filter(p=>p.career.played>=20).sort((a,b)=>b.career.winPercentage-a.career.winPercentage).slice(0,10);
  const teams = [];
  Object.values(database.historic?.seasons || {}).forEach(season => Object.values(season.teams || {}).forEach(team => (team.fixtures || []).forEach(fixture => {
    if (fixture.scoreLeft == null || fixture.scoreRight == null) return;
    const ksbLeft = String(fixture.teamLeftSlug || "").startsWith("ksb-");
    const ksbRight = String(fixture.teamRightSlug || "").startsWith("ksb-");
    if (!ksbLeft && !ksbRight) return;
    teams.push({season:season.season,opponent:ksbLeft?fixture.teamRightName:fixture.teamLeftName,opponentSlug:ksbLeft?fixture.teamRightSlug:fixture.teamLeftSlug,won:ksbLeft?fixture.scoreLeft>fixture.scoreRight:fixture.scoreRight>fixture.scoreLeft});
  })));
  const opponents=[...new Set(teams.map(x=>x.opponent).filter(Boolean))].sort();
  const leaderboard = (list,metric,suffix="") => `<div class="insight-list">${list.map((p,i)=>`<a href="${profileLink(p)}"><b>${i+1}</b><span>${esc(p.name)}</span><strong>${p.career[metric]}${suffix}</strong></a>`).join("")}</div>`;
  return `<div class="profile-chart-grid"><section class="profile-panel"><h2>Most KSB matches</h2>${leaderboard(mostMatches,"played")}</section><section class="profile-panel"><h2>Highest career win percentage</h2><p class="profile-help">Minimum 20 recorded matches.</p>${leaderboard(bestPct,"winPercentage","%")}</section></div>`;
}

function extraPlayerStats(player, database, opposition) {
  const clubs=playerClubRecord(player,opposition), mostFacedClub=clubs[0];
  const mostClubWins=[...clubs].sort((a,b)=>b.wins-a.wins||b.played-a.played)[0];
  const bestClub=[...clubs].filter(c=>c.played>=5).sort((a,b)=>b.winPercentage-a.winPercentage||b.played-a.played)[0];
  const toughestClub=[...clubs].filter(c=>c.played>=5).sort((a,b)=>a.winPercentage-b.winPercentage||b.played-a.played)[0];
  const historical=seasonsOf(player).filter(season=>Number(season.season)<=Number(database.coverage?.historicEndSeason||2025));
  const opponents=careerOpponentMap(player,database,opposition).filter(item=>item.played>0);
  const bestSeason=[...historical].filter(season=>stat(season,"played")>0).sort((a,b)=>stat(b,"winPercentage")-stat(a,"winPercentage")||stat(b,"played")-stat(a,"played"))[0];
  const busiest=[...historical].sort((a,b)=>stat(b,"played")-stat(a,"played"))[0];
  const mostWins=[...opponents].sort((a,b)=>b.wins-a.wins||b.played-a.played)[0];
  const mostLosses=[...opponents].sort((a,b)=>b.losses-a.losses||b.played-a.played)[0];
  const frequent=[...opponents].sort((a,b)=>b.played-a.played||a.name.localeCompare(b.name))[0];
  const bestOpponent=[...opponents].filter(item=>item.played>=3).sort((a,b)=>b.winPercentage-a.winPercentage||b.played-a.played)[0];
  const close=[...opponents].filter(item=>item.played>=3).sort((a,b)=>Math.abs(a.winPercentage-50)-Math.abs(b.winPercentage-50)||b.played-a.played)[0];
  const card=(label,value,detail)=>`<article class="extra-stat-card"><span>${label}</span><strong>${esc(value??"-")}</strong><small>${esc(detail||"")}</small></article>`;
  return `<div class="extra-stats-grid">${card("Best season",bestSeason?.season,bestSeason?`${stat(bestSeason,"winPercentage")}% wins · ${stat(bestSeason,"wins")}-${stat(bestSeason,"losses")}`:"No recorded matches")}${card("Most matches in a season",busiest?.season,busiest?`${stat(busiest,"played")} matches`:"")}${card("Most wins against",mostWins?.name,mostWins?`${mostWins.wins} wins from ${mostWins.played}`:"No opponent data")}${card("Most losses against",mostLosses?.name,mostLosses?`${mostLosses.losses} losses from ${mostLosses.played}`:"No opponent data")}${card("Most frequent opponent",frequent?.name,frequent?`${frequent.played} matches`:"No opponent data")}${card("Best opponent record",bestOpponent?.name,bestOpponent?`${bestOpponent.winPercentage}% over ${bestOpponent.played} matches`:"Minimum 3 matches")}${card("Closest rivalry",close?.name,close?`${close.wins}-${close.losses} · ${close.played} matches`:"Minimum 3 matches")}${card("Career sets won %",`${pct(player.career?.setsWon||0,(player.career?.setsWon||0)+(player.career?.setsLost||0))}%`,`${player.career?.setsWon||0}-${player.career?.setsLost||0} sets`)}${card("Most faced club",mostFacedClub?.name,mostFacedClub?`${mostFacedClub.played} individual matches`:"No club data")}${card("Most wins against a club",mostClubWins?.name,mostClubWins?`${mostClubWins.wins} wins from ${mostClubWins.played}`:"No club data")}${card("Best club record",bestClub?.name,bestClub?`${bestClub.winPercentage}% over ${bestClub.played} matches`:"Minimum 5 matches")}${card("Toughest club",toughestClub?.name,toughestClub?`${toughestClub.winPercentage}% over ${toughestClub.played} matches`:"Minimum 5 matches")}</div><section class="profile-panel"><h2>Season comparison</h2><div class="chart-box"><canvas id="extraSeasonChart"></canvas></div><p class="profile-help">Individual match win percentage for every recorded season.</p></section>`;
}

function oppositionTeamForSeason(opposition, opponentSlug, season) {
  const record = (opposition?.players?.[opponentSlug]?.teamHistory || []).find(item => Number(item.season) === Number(season));
  return record?.team?.name || "";
}

function playerClubRecord(player, opposition) {
  const clubs = new Map();
  seasonsOf(player).forEach(season => (season.statistics?.encounters || []).forEach(match => {
    if (!hasRecordedOpponent(match)) return;
    const team = oppositionTeamForSeason(opposition, match.opponentSlug, season.season);
    if (!team) return;
    const row = clubs.get(team) || {name:team,played:0,wins:0,losses:0,draws:0,setsWon:0,setsLost:0};
    row.played++; row.setsWon += Number(match.playerScore||0); row.setsLost += Number(match.opponentScore||0);
    if(match.result==="W")row.wins++; else if(match.result==="L")row.losses++; else row.draws++;
    clubs.set(team,row);
  }));
  return [...clubs.values()].map(row=>({...row,winPercentage:pct(row.wins,row.played)})).sort((a,b)=>b.played-a.played||a.name.localeCompare(b.name));
}

function playerClubPanel(player, opposition, location="extra") {
  const rows=playerClubRecord(player,opposition);
  const title=location==="team-context"?"Individual record against opposition clubs":`${player.name}'s record against each club`;
  return `<section class="profile-panel opposition-club-panel"><div class="panel-heading-row"><div><h2>${esc(title)}</h2><p class="profile-help">“Played” counts individual matches against players representing that club in the relevant season. Match win % counts match results, not sets. A 3-2 victory is one match win and therefore 100% for that match; Sets won % would be 60%.</p></div><span class="data-badge">Individual matches</span></div>${rows.length?`<div class="table-responsive"><table class="table table-dark table-striped align-middle player-history-table"><thead><tr><th class="text-start">Opposition club</th><th>Played</th><th>Wins</th><th>Losses</th><th>Match win %</th><th>Sets W-L</th><th>Sets won %</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="text-start">${esc(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.winPercentage}%</td><td>${r.setsWon}-${r.setsLost}</td><td>${pct(r.setsWon,r.setsWon+r.setsLost)}%</td></tr>`).join("")}</tbody></table></div>`:'<div class="ksb-player-empty">No opposition club information recorded.</div>'}</section>`;
}

function oppositionInsights(opposition) {
  const players=Object.values(opposition?.players||{}).sort((a,b)=>(b.ksbCareer?.played||0)-(a.ksbCareer?.played||0));
  const teams=Object.values(opposition?.oppositionTeams||{}).sort((a,b)=>(b.played||0)-(a.played||0));
  const topPlayers=players.slice(0,10),topTeams=teams.slice(0,10),total=opposition?.coverage?.ksbEncounterCount||0;
  const best=[...teams].filter(t=>t.played>=20).sort((a,b)=>b.winPercentage-a.winPercentage)[0],toughest=[...teams].filter(t=>t.played>=20).sort((a,b)=>a.winPercentage-b.winPercentage)[0];
  const card=(l,v,d)=>`<article class="club-summary-card"><span>${l}</span><strong>${esc(v)}</strong><small>${esc(d)}</small></article>`;
  return `<section class="club-insights-hero"><div><span class="eyebrow">KSB opposition archive</span><h2>Opposition insights</h2><p>Explore KSB's individual-match record against opposition players and the clubs represented by those players.</p></div><span class="data-badge">2013 onwards</span></section><section class="profile-panel opposition-explorer"><h2>Explore the opposition archive</h2><p class="profile-help">Club totals count individual matches against players representing that club. A 3-2 victory counts as one win, not 60%.</p><div class="lookup-controls"><label><span>KSB's individual record against a club</span><select id="oppositionTeamLookup" class="form-select"><option value="">Select a club</option>${teams.map(t=>`<option value="${esc(t.slug)}">${esc(t.name)}</option>`).join("")}</select></label><label><span>Opposition player history</span><select id="oppositionPlayerLookup" class="form-select"><option value="">Select a player</option>${players.map(p=>`<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("")}</select></label></div><div id="oppositionInsightOutput" class="club-opponent-output"></div></section><div class="profile-chart-grid opposition-leaders"><section class="profile-panel"><h2>Most-faced opposition clubs</h2><div class="insight-list">${topTeams.map((t,i)=>`<div class="opposition-rank-row"><b>${i+1}</b><span>${esc(t.name)}<small>${t.wins}-${t.losses} · ${t.winPercentage}% match wins</small></span><strong>${t.played} matches</strong></div>`).join("")}</div></section><section class="profile-panel"><h2>Most-faced opposition players</h2><div class="insight-list">${topPlayers.map((x,i)=>`<div class="opposition-rank-row"><b>${i+1}</b><span>${esc(x.name)}<small>${x.ksbCareer?.wins||0}-${x.ksbCareer?.losses||0} KSB record</small></span><strong>${x.ksbCareer?.played||0} matches</strong></div>`).join("")}</div></section></div>`;
}

function clubInsights(database, opposition) {
  return `${clubInsightsBase(database)}${oppositionInsights(opposition)}`;
}

function createChart(id, labels, values, colour, title, percent=false) {
  const canvas = document.getElementById(id); if (!canvas || typeof Chart === "undefined") return;
  new Chart(canvas,{type:"line",data:{labels,datasets:[{data:values,borderColor:colour,backgroundColor:`${colour}22`,fill:true,tension:.25,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#c8d0d8"},grid:{color:"rgba(255,255,255,.07)"}},y:{beginAtZero:percent,suggestedMax:percent?100:undefined,ticks:{color:"#c8d0d8"},grid:{color:"rgba(255,255,255,.07)"},title:{display:true,text:title,color:"#c8d0d8"}}}}});
}

function activateTabs(root, buttonSelector, panelSelector, key) {
  root.querySelectorAll(buttonSelector).forEach(button => button.addEventListener("click", () => {
    root.querySelectorAll(buttonSelector).forEach(item => item.classList.toggle("active", item === button));
    root.querySelectorAll(panelSelector).forEach(panel => panel.classList.toggle("active", panel.dataset[key] === button.dataset[key.replace("panel", "tab")]));
  }));
}

function bindClubInsights(database, opposition) {
  const oppositionTeamSelect = document.getElementById("oppositionTeamLookup");
  const oppositionPlayerSelect = document.getElementById("oppositionPlayerLookup");
  const oppositionOutput = document.getElementById("oppositionInsightOutput");

  if (oppositionTeamSelect && oppositionOutput) {
    oppositionTeamSelect.onchange = () => {
      const team = opposition?.oppositionTeams?.[oppositionTeamSelect.value];
      oppositionOutput.innerHTML = team
        ? `<strong>${esc(team.name)}</strong><span>${team.played} individual matches · ${team.wins} KSB wins · ${team.losses} losses · ${team.winPercentage}% win rate</span>`
        : "";
    };
  }

  if (oppositionPlayerSelect && oppositionOutput) {
    oppositionPlayerSelect.onchange = () => {
      const opponent = opposition?.players?.[oppositionPlayerSelect.value];
      const teams = [...new Set((opponent?.teamHistory || []).map(record => record.team?.name).filter(Boolean))];
      oppositionOutput.innerHTML = opponent
        ? `<strong>${esc(opponent.name)}</strong><span>${opponent.ksbCareer?.played || 0} matches against KSB · Teams represented: ${esc(teams.length ? teams.join(", ") : "Opposition team not recorded")}</span>`
        : "";
    };
  }
}

async function initProfile() {
  const host = document.getElementById("playerProfile"); if (!host) return;
  try {
    const [database, opposition] = await Promise.all([loadDatabase(), loadOppositionDatabase()]);
    const slug = new URLSearchParams(location.search).get("id");
    const player = database.players?.[slug]; if (!player) throw new Error("Player profile not found.");
    const seasons = seasonsOf(player), latest = seasons.at(-1), currentYear = Number(database.coverage?.currentSeason || 2026);
    document.title = `${player.name} - KSB Table Tennis Club`;
    host.className = "player-profile";
    host.innerHTML = `<header class="player-profile-hero"><div><p class="profile-kicker">KSB player profile</p><h1>${esc(player.name)}</h1><p>${seasons[0]?.season} to ${latest?.season} · ${seasons.length} recorded seasons</p><p class="records-start-note">Club records begin in 2013. Earlier seasons were not recorded and are not shown.</p></div><div class="profile-rank"><strong>${esc(rankOf(latest))}</strong><span>Latest rank</span></div></header>
      <nav class="profile-main-tabs"><button class="active" data-main-tab="team">Team context</button><button data-main-tab="past">Past seasons</button><button data-main-tab="lookup">Career lookup</button><button data-main-tab="extra">Extra stats</button></nav>
      <section class="profile-main-panel active" data-main-panel="team">${teamContext(player,database,opposition)}</section>
      <section class="profile-main-panel" data-main-panel="past">${pastSeasons(player,database)}</section>
      <section class="profile-main-panel" data-main-panel="lookup">${careerLookup(player,database)}</section>
      <section class="profile-main-panel" data-main-panel="extra">${extraPlayerStats(player,database,opposition)}${playerClubPanel(player,opposition)}</section>`;

    host.querySelectorAll("[data-main-tab]").forEach(button => button.onclick = () => { host.querySelectorAll("[data-main-tab]").forEach(item=>item.classList.toggle("active",item===button)); host.querySelectorAll("[data-main-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.mainPanel===button.dataset.mainTab)); });
    host.querySelectorAll("[data-subtab]").forEach(button => button.onclick = () => { host.querySelectorAll("[data-subtab]").forEach(item=>item.classList.toggle("active",item===button)); host.querySelectorAll("[data-subpanel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.subpanel===button.dataset.subtab)); });

    const historical = seasons.filter(s=>Number(s.season)<=Number(database.coverage?.historicEndSeason||2025));
    const teamRows = historical.map(s=>{const t=database.historic?.seasons?.[String(s.season)]?.teams?.[s.team?.slug],f=(t?.fixtures||[]).filter(x=>x.scoreLeft!=null&&x.scoreRight!=null);let w=0;f.forEach(x=>{const left=x.teamLeftSlug===s.team?.slug;if(Number(left?x.scoreLeft:x.scoreRight)>Number(left?x.scoreRight:x.scoreLeft))w++});return {season:s.season,rank:rankOf(s),rate:pct(w,f.length)}});
    createChart("teamRankChart",teamRows.map(x=>x.season),teamRows.map(x=>x.rank),"#66b3ff","Ranking points");
    createChart("teamRateChart",teamRows.map(x=>x.season),teamRows.map(x=>x.rate),"#45c486","Team win %",true);
    createChart("individualWinChart",historical.map(s=>s.season),historical.map(s=>stat(s,"winPercentage")),"#66b3ff","Match win %",true);
    createChart("setWinChart",historical.map(s=>s.season),historical.map(s=>setPct(s.statistics)),"#d69b4b","Sets won %",true);
    createChart("extraSeasonChart",historical.map(s=>s.season),historical.map(s=>stat(s,"winPercentage")),"#9b7be5","Individual win %",true);

    const drawSeason = () => { const season=seasonOf(player,document.getElementById("seasonSelect").value); document.getElementById("seasonDetail").innerHTML=`${metricTiles(season.statistics,true,rankOf(season))}<div class="two-scroll-panels"><div><h3>Opponent record</h3>${opponentCards(season.statistics?.opponents||[],database,season.season)}</div><div><h3>Individual results</h3>${resultCards(season.statistics?.encounters||[],database,season.season)}</div></div>`; };
    document.getElementById("seasonSelect")?.addEventListener("change",drawSeason); if(document.getElementById("seasonSelect")) drawSeason();

    const opponentData=careerOpponentMap(player,database,opposition), oppSearch=document.getElementById("careerOpponentSearch"), lookupOut=document.getElementById("careerLookupResults");
    function drawLookup(){const q=oppSearch.value.toLowerCase();const rows=opponentData.filter(o=>!q||o.name.toLowerCase().includes(q));lookupOut.innerHTML=rows.length?`<div class="lookup-result-grid">${rows.map(o=>`<article><h3>${esc(o.name)}</h3><p class="opposition-team-history"><b>Teams represented:</b> ${esc(o.teams.length ? o.teams.join(", ") : "Opponent not recorded")}</p><div><span>${o.played}<small>Matches</small></span><span>${o.wins}-${o.losses}<small>W-L</small></span><span>${o.winPercentage}%<small>Win rate</small></span><span>${o.setPercentage}%<small>Sets won</small></span></div><div class="lookup-match-scroll">${o.matches.map(m=>`<p>${resultBadge(m.result)} ${m.season} · ${m.playerScore}-${m.opponentScore} · ${esc(teamName(seasonOf(player,m.season)))} · Opposition: ${esc(oppositionTeamForSeason(opposition,m.opponentSlug,m.season) || "Team not recorded")}</p>`).join("")}</div></article>`).join("")}</div>`:'<div class="ksb-player-empty">No matching career records.</div>'};oppSearch.addEventListener("input",drawLookup);drawLookup();


  } catch(error) { host.className="status-panel error"; host.textContent=error.message; }
}

document.addEventListener("DOMContentLoaded",()=>{initPlayersPage();initProfile();});

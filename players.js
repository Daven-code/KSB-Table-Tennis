// ===== KSB PLAYER DIRECTORY =====
// Change to 2026 when the new season roster data is available.
const PLAYER_CURRENT_SEASON = 2025;
const PLAYER_DATA_FILE = "player-data.json";

function playerEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
}

async function getPlayerData() {
  const response = await fetch(PLAYER_DATA_FILE, { cache:"no-cache" });
  if (!response.ok) throw new Error(`Could not load ${PLAYER_DATA_FILE} (${response.status}).`);
  return response.json();
}

function getSeason(player, year) { return player.seasons.find(season => season.season === year); }
function getLatest(player) { return player.seasons[player.seasons.length - 1] || {}; }
function profileUrl(player) { return `player.html?id=${encodeURIComponent(player.slug)}`; }

function renderDirectoryCards(players, mode) {
  if (!players.length) return '<div class="ksb-player-empty">No matching player records.</div>';
  return `<div class="ksb-player-grid">${players.map(player => {
    const current = getSeason(player, PLAYER_CURRENT_SEASON);
    const latest = getLatest(player);
    const isCurrent = mode === "current";
    const detail = isCurrent ? `${playerEscape(current.team)} · ${PLAYER_CURRENT_SEASON}` : `${player.firstSeason} to ${player.lastSeason}`;
    const rank = isCurrent ? current.rank : latest.rank;
    return `<a class="ksb-player-card" href="${profileUrl(player)}">
      <span class="ksb-player-main"><strong>${playerEscape(player.name)}</strong><small>${detail}</small></span>
      <span class="ksb-rank-block"><strong>${playerEscape(rank ?? "-")}</strong><small>${isCurrent ? `${PLAYER_CURRENT_SEASON} rank` : "Latest rank"}</small></span>
      <span class="ksb-card-chevron" aria-hidden="true">›</span>
    </a>`;
  }).join("")}</div>`;
}

function buildDirectory(host, players, mode) {
  const teams = [...new Set((mode === "current"
    ? players.map(player => getSeason(player, PLAYER_CURRENT_SEASON)?.team)
    : players.flatMap(player => player.seasons.map(season => season.team))
  ).filter(Boolean))].sort();

  host.className = "ksb-player-directory";
  host.innerHTML = `<div class="ksb-directory-controls">
    <label><span>Search player</span><input type="search" class="form-control" placeholder="Enter a player name"></label>
    <label><span>Played for</span><select class="form-select"><option value="">All KSB teams</option>${teams.map(team => `<option value="${playerEscape(team)}">${playerEscape(team)}</option>`).join("")}</select></label>
    <output class="ksb-player-count"></output>
  </div><div class="ksb-directory-results"></div>`;

  const search = host.querySelector("input");
  const select = host.querySelector("select");
  const count = host.querySelector("output");
  const results = host.querySelector(".ksb-directory-results");

  function refresh() {
    const query = search.value.trim().toLowerCase();
    const team = select.value;
    let filtered = players.filter(player => !query || player.name.toLowerCase().includes(query));
    if (team) filtered = filtered.filter(player => mode === "current"
      ? getSeason(player, PLAYER_CURRENT_SEASON)?.team === team
      : player.seasons.some(season => season.team === team));
    filtered.sort(mode === "current"
      ? (a,b) => (getSeason(b, PLAYER_CURRENT_SEASON)?.rank || 0) - (getSeason(a, PLAYER_CURRENT_SEASON)?.rank || 0) || a.name.localeCompare(b.name)
      : (a,b) => a.name.localeCompare(b.name));
    count.textContent = `${filtered.length} player${filtered.length === 1 ? "" : "s"}`;
    results.innerHTML = renderDirectoryCards(filtered, mode);
  }
  search.addEventListener("input", refresh);
  select.addEventListener("change", refresh);
  refresh();
}

async function initialisePlayersPage() {
  const currentHost = document.getElementById("currentPlayersContent");
  if (!currentHost) return;
  const historicHost = document.getElementById("historicPlayersContent");
  try {
    const data = await getPlayerData();
    const all = data.players || [];
    buildDirectory(currentHost, all.filter(player => getSeason(player, PLAYER_CURRENT_SEASON)), "current");
    buildDirectory(historicHost, all, "historic");
  } catch (error) {
    currentHost.className = historicHost.className = "status-panel error";
    currentHost.textContent = historicHost.textContent = error.message;
  }
}

function makeChart(canvas, labels, values, colour, title, percent=false) {
  if (!canvas || typeof Chart === "undefined") return;
  new Chart(canvas,{type:"line",data:{labels,datasets:[{data:values,borderColor:colour,backgroundColor:colour+"22",fill:true,tension:.25,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#c8d0d8"},grid:{color:"rgba(255,255,255,.07)"}},y:{beginAtZero:percent,suggestedMax:percent?100:undefined,ticks:{color:"#c8d0d8"},grid:{color:"rgba(255,255,255,.07)"},title:{display:true,text:title,color:"#c8d0d8"}}}}});
}

async function initialisePlayerProfile() {
  const host=document.getElementById("playerProfile"); if(!host) return;
  try {
    const data=await getPlayerData();
    const slug=new URLSearchParams(location.search).get("id");
    const player=data.players.find(item=>item.slug===slug);
    if(!player) throw new Error("Player profile not found.");
    const asc=[...player.seasons].sort((a,b)=>a.season-b.season), desc=[...asc].reverse(), latest=asc[asc.length-1];
    document.title=`${player.name} - KSB Table Tennis Club`;
    host.className="player-profile";
    host.innerHTML=`<header class="player-profile-hero"><div><p class="profile-kicker">KSB player profile</p><h1>${playerEscape(player.name)}</h1><p>${player.firstSeason} to ${player.lastSeason} · ${player.seasons.length} recorded seasons</p><p class="records-start-note">Club records in this archive begin in 2013. Earlier seasons were not recorded and are not shown.</p></div><div class="profile-rank"><strong>${playerEscape(latest.rank??"-")}</strong><span>Latest rank</span></div></header>
    <div class="profile-summary-grid"><div><span>Latest team</span><strong>${playerEscape(latest.team)}</strong></div><div><span>Latest division</span><strong>${playerEscape(latest.division)}</strong></div><div><span>First season</span><strong>${player.firstSeason}</strong></div><div><span>Latest season</span><strong>${player.lastSeason}</strong></div></div>
    <div class="profile-chart-grid"><section class="profile-panel"><h2>Ranking history</h2><div class="chart-box"><canvas id="rankChart"></canvas></div></section><section class="profile-panel"><h2>Team win rate by season</h2><div class="chart-box"><canvas id="teamWinChart"></canvas></div><p class="profile-help">Team results, not individual player results.</p></section></div>
    <section class="profile-panel"><div class="profile-panel-heading"><h2>Season-by-season history</h2><p>Team context for seasons in which the player appeared on the registered squad.</p></div><div class="table-responsive"><table class="table table-dark table-striped align-middle player-history-table"><thead><tr><th>Season</th><th class="text-start">Team</th><th>Division</th><th>Rank</th><th>Team Played</th><th>Team Wins</th><th>Team Draws</th><th>Team Losses</th><th>Team Win %</th></tr></thead><tbody>${desc.map(s=>`<tr><td>${s.season}</td><td class="text-start">${playerEscape(s.team)}</td><td>${playerEscape(s.division)}</td><td><strong>${playerEscape(s.rank??"-")}</strong></td><td>${s.teamRecord.played}</td><td>${s.teamRecord.wins}</td><td>${s.teamRecord.draws}</td><td>${s.teamRecord.losses}</td><td>${s.teamRecord.winPercentage}%</td></tr>`).join("")}</tbody></table></div></section>`;
    makeChart(document.getElementById("rankChart"),asc.map(s=>s.season),asc.map(s=>s.rank),"#66b3ff","Ranking points");
    makeChart(document.getElementById("teamWinChart"),asc.map(s=>s.season),asc.map(s=>s.teamRecord.winPercentage),"#45c486","Team win %",true);
  } catch(error) { host.className="status-panel error"; host.textContent=error.message; }
}

document.addEventListener("DOMContentLoaded",()=>{initialisePlayersPage();initialisePlayerProfile();});

// Shared player-data adapter. When API URLs are supplied, add them only in player-data.json.
async function loadPlayerStore() {
  const response = await fetch("player-data.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Player configuration could not be loaded.");
  return response.json();
}
function playerLink(player) { return `player.html?id=${encodeURIComponent(player.id || player.slug || player.name)}`; }
function renderPlayerTable(players) {
  if (!players.length) return '<div class="status-panel">No player records have been supplied yet.</div>';
  const sorted=[...players].sort((a,b)=>(Number(a.rank)||9999)-(Number(b.rank)||9999));
  return `<div class="table-responsive"><table class="table table-dark table-striped table-hover"><thead><tr><th>Rank</th><th class="text-start">Player</th><th>Team</th><th>Played</th><th>Wins</th><th>Win %</th></tr></thead><tbody>${sorted.map(p=>`<tr><td>${p.rank || "-"}</td><td class="text-start"><a href="${playerLink(p)}">${p.name}</a></td><td>${p.team || "-"}</td><td>${p.played ?? "-"}</td><td>${p.wins ?? "-"}</td><td>${p.winRate != null ? `${p.winRate}%` : "-"}</td></tr>`).join("")}</tbody></table></div>`;
}
async function initialisePlayersPage() {
  const current=document.getElementById("currentPlayersContent");
  if (!current) return;
  try {
    const store=await loadPlayerStore();
    const players=store.players || [];
    current.innerHTML=renderPlayerTable(players.filter(p=>p.current !== false)); current.className="";
    const historic=document.getElementById("historicPlayersContent");
    historic.innerHTML=renderPlayerTable(players); historic.className="";
  } catch(error) { current.textContent=error.message; }
}
async function initialisePlayerProfile() {
  const host=document.getElementById("playerProfile"); if(!host) return;
  try {
    const store=await loadPlayerStore();
    const id=new URLSearchParams(location.search).get("id");
    const player=(store.players||[]).find(p=>String(p.id||p.slug||p.name)===id);
    if(!player) return;
    host.className="team-shell p-4";
    host.innerHTML=`<h1>${player.name}</h1><p class="small-note">Full career and season-by-season statistics will appear here.</p><div id="playerCareerContent"></div>`;
  } catch(error) { host.textContent=error.message; }
}
document.addEventListener("DOMContentLoaded",()=>{ initialisePlayersPage(); initialisePlayerProfile(); });

const DIVISIONS = ["premier", "first", "second", "third"];
const LABELS = { premier: "Premier", first: "First", second: "Second", third: "Third" };
const escapeLeagueHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[character]);

function normaliseLeagueRow(row, index) {
  const played = Number(row.pl ?? row.played ?? row.matchesPlayed ?? 0);
  const wins = Number(row.w ?? row.won ?? row.wins ?? row.matchesWon ?? 0);
  const draws = Number(row.d ?? row.drawn ?? row.draws ?? row.matchesDrawn ?? 0);
  const explicitLosses = row.l ?? row.lost ?? row.losses ?? row.matchesLost;
  const calculatedLosses = Math.max(0, played - wins - draws);
  const suppliedLosses = explicitLosses == null ? calculatedLosses : Number(explicitLosses);
  const losses = played === wins + draws + suppliedLosses ? suppliedLosses : calculatedLosses;
  return {
    p: Number(row.p ?? row.position ?? row.pos ?? index + 1),
    t: row.t ?? row.team?.name ?? row.teamName ?? row.name ?? "Unknown team",
    pl: played,
    w: wins,
    d: draws,
    l: losses,
    pts: Number(row.pts ?? row.points ?? row.score ?? 0)
  };
}

function renderLeagueTable(rows, division, season) {
  const host = document.getElementById("leagueTableHost");
  const data = (rows || []).map(normaliseLeagueRow).sort((a,b) => a.p - b.p);
  if (!data.length) {
    host.innerHTML = `<div class="league-empty"><h3>${LABELS[division]} Division</h3><p>No teams are listed yet for ${season}. The table will update automatically after results are published.</p></div>`;
    return;
  }
  const body = data.map(team => {
    const ksb = /^KSB(?:\s|$)/i.test(team.t);
    const winRate = team.pl ? Math.round(team.w / team.pl * 100) : 0;
    return `<tr class="${ksb ? "league-row-ksb" : ""}"><td><span class="position-badge">${team.p}</span></td><td class="text-start">${escapeLeagueHtml(team.t)}</td><td>${team.pl}</td><td>${team.w}</td><td>${team.d}</td><td>${team.l}</td><td>${winRate}%</td><td><strong>${team.pts}</strong></td></tr>`;
  }).join("");
  host.innerHTML = `<div class="league-table-heading"><div><span class="league-kicker">${season} season</span><h2>${LABELS[division]} Division Table</h2></div><span>${data.length} teams listed</span></div><div class="table-responsive"><table class="table table-dark table-striped table-hover align-middle league-page-table"><thead><tr><th>Pos</th><th class="text-start">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Win %</th><th>Pts</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

async function initialiseLeaguePage() {
  const host = document.getElementById("leagueTableHost");
  try {
    const response = await fetch("league-history.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not load league-history.json (${response.status}).`);
    const archive = await response.json();
    const seasons = Object.keys(archive.data || {}).map(Number).sort((a,b) => b-a);
    const currentSeason = Number(archive.currentSeason || seasons[0]);
    const seasonSelect = document.getElementById("leagueSeasonSelect");
    seasonSelect.innerHTML = seasons.map(season => `<option value="${season}">${season}</option>`).join("");
    seasonSelect.value = String(currentSeason);
    let division = "premier";
    const draw = () => renderLeagueTable(archive.data?.[seasonSelect.value]?.[division] || [], division, seasonSelect.value);
    document.querySelectorAll("[data-league-division]").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll("[data-league-division]").forEach(item => item.classList.toggle("active", item === button));
      division = button.dataset.leagueDivision;
      draw();
    }));
    seasonSelect.addEventListener("change", draw);
    draw();
  } catch (error) {
    host.innerHTML = `<div class="league-empty league-error"><h3>League tables unavailable</h3><p>${escapeLeagueHtml(error.message)}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", initialiseLeaguePage);

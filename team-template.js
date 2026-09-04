// ===== KSB TEAM PAGE DATA AND DISPLAY =====
// League tables are embedded from east_lancs_tt_league_data.xlsx.
// No API request or separate JSON file is required.
// Change this one value to 2027 next season.
const CURRENT_SEASON = 2026;
const API_ROOT = "https://eastlancstt.org.uk/api/result";
const DIVISIONS = ["premier", "first", "second", "third"];

// Current team allocation. Individual team pages now only provide teamName,
// so the shared template must not rely on a separate global division variable.
const CURRENT_TEAM_DIVISIONS = {
  "KSB A": "premier",
  "KSB B": "premier",
  "KSB C": "premier",
  "KSB D": "first",
  "KSB E": "first",
  "KSB F": "first",
  "KSB G": "second",
  "KSB Lions": "second",
  "KSB Tigers": "second",
  "KSB Jaguars": "second",
  "KSB Leopards": "third",
  "KSB Pumas": "third",
  "KSB Panthers": "third"
};
let leagueData = {};
let leagueStatuses = {};

const teamSlugs = {
  "KSB A":"ksb-a", "KSB B":"ksb-b", "KSB C":"ksb-c", "KSB D":"ksb-d",
  "KSB E":"ksb-e", "KSB F":"ksb-f", "KSB G":"ksb-g", "KSB Lions":"ksb-lions",
  "KSB Tigers":"ksb-tigers-jun", "KSB Jaguars":"ksb-jaguars",
  "KSB Leopards":"ksb-leopards-jun", "KSB Pumas":"ksb-pumas-jun",
  "KSB Panthers":"ksb-panthers-jun"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[character]);
}

function divisionTitle(value) {
  return ({ premier:"Premier", first:"First", second:"Second", third:"Third" })[value] || value;
}

function parseCSV(text) {
  const rows = text.trim().split(/\r?\n/);
  const headers = rows.shift().split(",");
  return rows.map(row => {
    const values = row.split(",");
    return Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() || ""]));
  });
}

function buildFixtureTable(fixtures, past = false) {
  if (!fixtures.length) return '<tbody><tr><td colspan="4"><em>No fixtures available.</em></td></tr></tbody>';
  const rows = fixtures.map(fixture => {
    const parsedDate = new Date(fixture.Date);
    const date = Number.isNaN(parsedDate.getTime()) ? fixture.Date : parsedDate.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
    return `<tr${past ? ' class="past-fixture"' : ""}><td>${escapeHtml(date)}</td><td>${escapeHtml(fixture["Home Team"])}</td><td>${escapeHtml(fixture["Away Team"])}</td><td>${escapeHtml(fixture.Venue)}</td></tr>`;
  }).join("");
  return `<thead><tr><th>Date</th><th>Home</th><th>Away</th><th>Venue</th></tr></thead><tbody>${rows}</tbody>`;
}

async function loadFixtures() {
  const upcomingTable = document.getElementById("upcomingTable");
  const pastTable = document.getElementById("pastTable");
  try {
    const response = await fetch(`${teamName} Fixtures.csv`);
    if (!response.ok) throw new Error(`Cannot load ${teamName} Fixtures.csv`);
    const fixtures = parseCSV(await response.text());
    const today = new Date(); today.setHours(0,0,0,0);
    const past = [], upcoming = [];
    fixtures.forEach(fixture => {
      const date = new Date(fixture.Date); date.setHours(0,0,0,0);
      (date < today ? past : upcoming).push(fixture);
    });
    upcomingTable.innerHTML = buildFixtureTable(upcoming);
    pastTable.innerHTML = buildFixtureTable(past.reverse(), true);
  } catch (error) {
    upcomingTable.innerHTML = `<tbody><tr><td colspan="4">${escapeHtml(error.message)}</td></tr></tbody>`;
    pastTable.innerHTML = "";
  }
}

function buildDivisionControl() {
  const seasonControl = document.querySelector(".season-control");
  if (!seasonControl || document.getElementById("divisionSelect")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "season-control";
  wrapper.innerHTML = `<label for="divisionSelect">Division</label><select id="divisionSelect" class="form-select form-select-sm" aria-label="Select division">${DIVISIONS.map(item => `<option value="${item}">${divisionTitle(item)}</option>`).join("")}</select>`;
  seasonControl.insertAdjacentElement("afterend", wrapper);
}

function populateSeasonOptions() {
  const select = document.getElementById("seasonSelect");
  const years = [...new Set([CURRENT_SEASON, ...Object.keys(leagueStatuses).map(Number)])].sort((a,b) => b-a);
  select.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join("");
  select.value = String(CURRENT_SEASON);
}

function teamDivisionForSeason(season) {
  const seasonData = leagueData[String(season)] || {};
  return DIVISIONS.find(item => (seasonData[item] || []).some(entry => entry.t === teamName));
}

function unavailableMessage(season, selectedDivision) {
  const status = leagueStatuses[String(season)]?.[selectedDivision] || "No table data is available.";
  if (status === "Retrieved") return `No table rows are available for the ${season} ${divisionTitle(selectedDivision)} Division.`;
  if (status.includes("No 2020 season")) return "There was no 2020 season in the league results archive.";
  if (status.includes("Current 2026")) return "The 2026-27 league table will appear here once results have been recorded.";
  if (status.includes("could not be retrieved")) return `The ${season} ${divisionTitle(selectedDivision)} Division table is not included in the supplied spreadsheet.`;
  return status;
}

function showNoLeagueData(season, selectedDivision) {
  const host = document.getElementById("leagueContent");
  host.className = "status-panel";
  host.innerHTML = `<div><h5 class="mb-2">League table not available</h5><p class="small-note mb-0">${escapeHtml(unavailableMessage(season, selectedDivision))}</p></div>`;
}

function renderLeague(data, season, selectedDivision) {
  const host = document.getElementById("leagueContent");
  const sorted = [...data].sort((a,b) => a.p - b.p);
  const currentTeam = sorted.find(entry => entry.t === teamName);
  const winRate = currentTeam?.pl ? Math.round((currentTeam.w / currentTeam.pl) * 100) : 0;
  const summary = currentTeam ? `<div class="summary-grid"><div class="summary-card"><span class="summary-label">Position</span><span class="summary-value">${currentTeam.p}</span></div><div class="summary-card"><span class="summary-label">Played</span><span class="summary-value">${currentTeam.pl}</span></div><div class="summary-card"><span class="summary-label">Wins</span><span class="summary-value">${currentTeam.w}</span></div><div class="summary-card"><span class="summary-label">Win rate</span><span class="summary-value">${winRate}%</span></div></div>` : `<p class="small-note">${escapeHtml(teamName)} is not listed in this table.</p>`;
  const rows = sorted.map(entry => {
    const isKsbTeam = /^KSB(?:\s|$)/i.test(String(entry.t).trim());
    const classes = [isKsbTeam ? "league-row-ksb" : "", entry.t === teamName ? "league-row-current" : ""].filter(Boolean).join(" ");
    const rate = entry.pl ? Math.round((entry.w / entry.pl) * 100) : 0;
    return `<tr class="${classes}"><td><span class="position-badge">${entry.p}</span></td><td class="text-start">${escapeHtml(entry.t)}</td><td>${entry.pl}</td><td>${entry.w}</td><td>${entry.d}</td><td>${entry.l}</td><td>${rate}%</td><td><strong>${entry.pts}</strong></td></tr>`;
  }).join("");
  host.className = "";
  host.innerHTML = `${summary}<div class="table-responsive"><table class="table table-dark table-striped table-hover align-middle"><thead><tr><th>Pos</th><th class="text-start">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Win %</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function fetchCurrentLeague(selectedDivision) {
  const response = await fetch(`${API_ROOT}/${CURRENT_SEASON}/${selectedDivision}/league`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Current table unavailable");
  const data = await response.json();
  return Array.isArray(data) ? data.map((entry, index) => ({
    p: index + 1,
    t: entry.team?.name || "Unknown team",
    w: Number(entry.won) || 0,
    d: Number(entry.draw) || 0,
    l: Number(entry.loss) || 0,
    pl: Number(entry.played) || 0,
    pts: Number(entry.points) || 0
  })) : [];
}

async function loadLeague(season, selectedDivision) {
  document.getElementById("leagueHeading").textContent = `${divisionTitle(selectedDivision)} Division Table`;

  if (season === CURRENT_SEASON) {
    try {
      const liveData = await fetchCurrentLeague(selectedDivision);
      if (liveData.length) {
        renderLeague(liveData, season, selectedDivision);
      } else {
        showNoLeagueData(season, selectedDivision);
      }
    } catch (_) {
      const savedData = leagueData[String(season)]?.[selectedDivision];
      if (Array.isArray(savedData) && savedData.length) renderLeague(savedData, season, selectedDivision);
      else showNoLeagueData(season, selectedDivision);
    }
    return;
  }

  const data = leagueData[String(season)]?.[selectedDivision];
  if (Array.isArray(data) && data.length) renderLeague(data, season, selectedDivision);
  else showNoLeagueData(season, selectedDivision);
}

function prepareMembers() {
  const membersLink = document.getElementById("membersLink");
  if (!membersLink) return;
  membersLink.href = `https://eastlancstt.org.uk/result/${CURRENT_SEASON}/team/${teamSlugs[teamName] || "ksb-a"}`;
}

async function initialiseTeamMembers() {
  const host = document.getElementById("teamMembersContent");
  if (!host) return;

  try {
    const response = await fetch("player-data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Player data is not available yet.");
    const store = await response.json();
    const players = (store.players || []).filter(player => player.team === teamName && player.current !== false);

    if (!players.length) {
      host.textContent = "No current player records are available for this team yet.";
      return;
    }

    host.className = "";
    host.innerHTML = `<div class="table-responsive"><table class="table table-dark table-striped table-hover align-middle"><thead><tr><th>Rank</th><th class="text-start">Player</th><th>Played</th><th>Wins</th><th>Win %</th></tr></thead><tbody>${players.map(player => `<tr><td>${escapeHtml(player.rank ?? "-")}</td><td class="text-start">${escapeHtml(player.name)}</td><td>${escapeHtml(player.played ?? "-")}</td><td>${escapeHtml(player.wins ?? "-")}</td><td>${player.winRate != null ? `${escapeHtml(player.winRate)}%` : "-"}</td></tr>`).join("")}</tbody></table></div>`;
  } catch (error) {
    host.textContent = error.message;
  }
}

async function loadLeagueHistory() {
  const response = await fetch("league-history.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load league-history.json (${response.status}).`);
  const archive = await response.json();
  leagueData = archive.data || {};
  leagueStatuses = archive.statuses || {};
}

document.addEventListener("DOMContentLoaded", async () => {
  loadFixtures();
  prepareMembers();
  initialiseTeamMembers();
  buildDivisionControl();

  const leagueHost = document.getElementById("leagueContent");

  try {
    await loadLeagueHistory();
    populateSeasonOptions();

    const seasonSelect = document.getElementById("seasonSelect");
    const divisionSelect = document.getElementById("divisionSelect");
    divisionSelect.value = teamDivisionForSeason(CURRENT_SEASON) || CURRENT_TEAM_DIVISIONS[teamName] || "premier";

    function refresh(autoChooseDivision = false) {
      const season = Number(seasonSelect.value);
      if (autoChooseDivision) {
        divisionSelect.value = teamDivisionForSeason(season) || divisionSelect.value;
      }
      loadLeague(season, divisionSelect.value);
    }

    seasonSelect.addEventListener("change", () => refresh(true));
    divisionSelect.addEventListener("change", () => refresh(false));
    const leagueTab = document.querySelector('[data-bs-target="#league"]');
    if (leagueTab) leagueTab.addEventListener("shown.bs.tab", () => refresh(true));
  } catch (error) {
    leagueHost.className = "status-panel error";
    leagueHost.innerHTML = `<div><h5>League data unavailable</h5><p>${escapeHtml(error.message)}</p></div>`;
  }
});

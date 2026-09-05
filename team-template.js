// ===== KSB TEAM PAGE DATA AND DISPLAY =====
// League tables are embedded from east_lancs_tt_league_data.xlsx.
// No API request or separate JSON file is required.
// Change this one value to 2027 next season.
const CURRENT_SEASON = 2026;
const PLAYER_CURRENT_SEASON = 2025;
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

function initialiseMobileFixtureControls() {
  const fixturesSection = document.getElementById("fixtures");
  if (!fixturesSection || fixturesSection.querySelector(".fixture-mobile-tools")) return;

  const tools = document.createElement("div");
  tools.className = "fixture-mobile-tools";
  tools.setAttribute("aria-label", "Mobile fixture table controls");
  tools.innerHTML = `
    <span class="fixture-tools-label">Table size</span>
    <div class="fixture-size-buttons" role="group" aria-label="Change fixture table size">
      <button type="button" class="fixture-size-button" data-fixture-size="smaller" aria-label="Make fixture table smaller">A-</button>
      <button type="button" class="fixture-size-button fixture-size-reset" data-fixture-size="reset" aria-label="Reset fixture table size">Reset</button>
      <button type="button" class="fixture-size-button" data-fixture-size="larger" aria-label="Make fixture table larger">A+</button>
    </div>
    <span class="fixture-scroll-hint">Swipe left or right to see all columns</span>`;

  fixturesSection.insertBefore(tools, fixturesSection.firstElementChild);

  const fixtureTables = [
    document.getElementById("upcomingTable"),
    document.getElementById("pastTable")
  ].filter(Boolean);

  const sizeSteps = [0.78, 0.9, 1, 1.12, 1.25];
  let sizeIndex = 2;

  function applySize() {
    fixtureTables.forEach(table => {
      table.style.setProperty("--fixture-scale", sizeSteps[sizeIndex]);
    });
  }

  tools.addEventListener("click", event => {
    const button = event.target.closest("[data-fixture-size]");
    if (!button) return;

    const action = button.dataset.fixtureSize;
    if (action === "smaller") sizeIndex = Math.max(0, sizeIndex - 1);
    if (action === "larger") sizeIndex = Math.min(sizeSteps.length - 1, sizeIndex + 1);
    if (action === "reset") sizeIndex = 2;
    applySize();
  });

  applySize();
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
  const host=document.getElementById("teamMembersContent");
  if(!host) return;
  const teamSlug=teamSlugs[teamName];
  try {
    const response=await fetch("player-data.json",{cache:"no-cache"});
    if(!response.ok) throw new Error(`Could not load player-data.json (${response.status}).`);
    const store=await response.json();
    const rosters=store.teamRosters||{};
    const card=(player,season,label)=>`<a class="ksb-player-card" href="player.html?id=${encodeURIComponent(player.slug)}"><span class="ksb-player-main"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(label)} · ${season}</small></span><span class="ksb-rank-block"><strong>${escapeHtml(player.rank??"-")}</strong><small>${season} rank</small></span><span class="ksb-card-chevron">›</span></a>`;
    const sorted=players=>[...players].sort((a,b)=>(b.rank||0)-(a.rank||0)||a.name.localeCompare(b.name));
    const current=rosters[String(PLAYER_CURRENT_SEASON)]?.[teamSlug];
    const historicYears=Object.keys(rosters).filter(year=>Number(year)<PLAYER_CURRENT_SEASON&&rosters[year]?.[teamSlug]?.players?.length).sort((a,b)=>b-a);
    host.className="ksb-team-members";
    host.innerHTML=`<div class="ksb-member-tabs"><button class="active" data-member-tab="current">Current Team</button><button data-member-tab="history">Historic Team Members</button></div>
      <section class="ksb-member-panel active" data-member-panel="current">${current?.players?.length?`<div class="ksb-roster-title"><div><h3>${PLAYER_CURRENT_SEASON} Team Members</h3><p>${escapeHtml(teamName)} · highest rank first</p></div><span>${current.players.length} players</span></div><div class="ksb-player-grid">${sorted(current.players).map(p=>card(p,PLAYER_CURRENT_SEASON,teamName)).join("")}</div>`:`<div class="ksb-player-empty">No ${PLAYER_CURRENT_SEASON} roster is available.</div>`}</section>
      <section class="ksb-member-panel" data-member-panel="history">${historicYears.length?`<div class="ksb-history-controls"><label>Season<select class="form-select" id="historySeason">${historicYears.map(y=>`<option>${y}</option>`).join("")}</select></label></div><div id="historyRoster"></div>`:'<div class="ksb-player-empty">No historic rosters are available.</div>'}</section>`;
    host.querySelectorAll("[data-member-tab]").forEach(button=>button.addEventListener("click",()=>{host.querySelectorAll("[data-member-tab]").forEach(b=>b.classList.toggle("active",b===button));host.querySelectorAll("[data-member-panel]").forEach(p=>p.classList.toggle("active",p.dataset.memberPanel===button.dataset.memberTab));}));
    const select=host.querySelector("#historySeason"), list=host.querySelector("#historyRoster");
    if(select&&list){const draw=()=>{const year=select.value,roster=rosters[year][teamSlug];list.innerHTML=`<div class="ksb-roster-title"><div><h3>${escapeHtml(roster.team?.name||teamName)}</h3><p>${escapeHtml(roster.team?.divisionName||"")} Division · ${year}</p></div><span>${roster.players.length} players</span></div><div class="ksb-player-grid">${sorted(roster.players).map(p=>card(p,year,roster.team?.name||teamName)).join("")}</div>`;};select.addEventListener("change",draw);draw();}
  } catch(error) { host.className="status-panel error"; host.textContent=error.message; }
}

async function loadLeagueHistory() {
  const response = await fetch("league-history.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load league-history.json (${response.status}).`);
  const archive = await response.json();
  leagueData = archive.data || {};
  leagueStatuses = archive.statuses || {};
}

document.addEventListener("DOMContentLoaded", async () => {
  initialiseMobileFixtureControls();
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

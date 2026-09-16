// ===== KSB TEAM PAGE DATA AND DISPLAY =====
// League tables are embedded from east_lancs_tt_league_data.xlsx.
// No API request or separate JSON file is required.
// Change this one value to 2027 next season.
let CURRENT_SEASON = 2026;
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
    const calculatedLosses = Math.max(0, Number(entry.pl) - Number(entry.w) - Number(entry.d));
    const suppliedLosses = Number(entry.l ?? calculatedLosses);
    const losses = Number(entry.pl) === Number(entry.w) + Number(entry.d) + suppliedLosses ? suppliedLosses : calculatedLosses;
    return `<tr class="${classes}"><td><span class="position-badge">${entry.p}</span></td><td class="text-start">${escapeHtml(entry.t)}</td><td>${entry.pl}</td><td>${entry.w}</td><td>${entry.d}</td><td>${losses}</td><td>${rate}%</td><td><strong>${entry.pts}</strong></td></tr>`;
  }).join("");
  host.className = "";
  host.innerHTML = `${summary}<div class="table-responsive"><table class="table table-dark table-striped table-hover align-middle"><thead><tr><th>Pos</th><th class="text-start">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Win %</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function currentLeagueRows(selectedDivision) {
  const rows = leagueData[String(CURRENT_SEASON)]?.[selectedDivision];
  return Array.isArray(rows) ? rows : [];
}

async function loadLeague(season, selectedDivision) {
  const data = season === CURRENT_SEASON
    ? currentLeagueRows(selectedDivision)
    : leagueData[String(season)]?.[selectedDivision];
  if (!Array.isArray(data)) {
    showNoLeagueData(season, selectedDivision);
    return;
  }
  renderLeague(data, season, selectedDivision);
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
    const [response, oppositionResponse] = await Promise.all([
      fetch("ksb_master_database.json", { cache: "no-cache" }),
      fetch("ksb_opposition_database.json", { cache: "no-cache" })
    ]);
    if (!response.ok) throw new Error("Could not load master database");
    const database = await response.json();
    const opposition = oppositionResponse.ok ? await oppositionResponse.json() : { players:{} };
    initialiseCurrentResults(database, opposition);
    const slug = teamSlugs[teamName];
    const year = database.coverage.currentSeason;
    const live = database.currentSeason.teams?.[slug];
    const historic = database.historic.seasons || {};
    const playerRecords = database.players || {};
    const historicYears = Object.keys(historic).filter(y => historic[y].teams?.[slug]?.players?.length).sort((a,b) => b-a);
    const profileLink = player => `player.html?id=${encodeURIComponent(player.slug)}`;
    const currentRow = player => {
      const stats = playerRecords[player.slug]?.seasons?.[String(year)]?.statistics || {};
      return `<tr><td class="text-start"><a href="${profileLink(player)}"><strong>${escapeHtml(player.name)}</strong></a></td><td>${player.rank ?? "-"}</td><td>${stats.played ?? 0}</td><td>${stats.wins ?? 0}</td><td>${stats.losses ?? 0}</td><td>${stats.winPercentage ?? 0}%</td><td>${stats.setsWon ?? 0}-${stats.setsLost ?? 0}</td></tr>`;
    };
    const currentTable = live?.players?.length ? `<div class="ksb-roster-title"><h3>${escapeHtml(live.team?.name || teamName)}</h3><span>${live.players.length} players</span></div><div class="table-responsive"><table class="table table-dark table-striped table-hover align-middle current-player-stats-table"><thead><tr><th class="text-start">Player</th><th>Rank</th><th>Played</th><th>Wins</th><th>Losses</th><th>Win %</th><th>Sets W-L</th></tr></thead><tbody>${[...live.players].sort((a,b)=>(b.rank||0)-(a.rank||0)).map(currentRow).join("")}</tbody></table></div>` : `<div class="current-season-empty"><h3>${year} team not published</h3><p>The current roster will appear after the next data update.</p></div>`;
    const historicGrid = (players, season) => `<div class="ksb-player-grid">${[...players].sort((a,b)=>(b.rank||0)-(a.rank||0)).map(player => `<a class="ksb-player-card" href="${profileLink(player)}"><span class="ksb-player-main"><strong>${escapeHtml(player.name)}</strong><small>${season}</small></span><span class="ksb-rank-block"><strong>${player.rank ?? "-"}</strong><small>${season} rank</small></span><span class="ksb-card-chevron">›</span></a>`).join("")}</div>`;
    host.className = "ksb-team-members";
    host.innerHTML = `<div class="ksb-member-tabs"><button class="active" data-member-tab="current">Current Team (${year})</button><button data-member-tab="history">Historic Team Members</button></div><section class="ksb-member-panel active" data-member-panel="current">${currentTable}</section><section class="ksb-member-panel" data-member-panel="history"><div class="ksb-history-controls"><label>Season<select id="historySeason" class="form-select">${historicYears.map(y=>`<option>${y}</option>`).join("")}</select></label></div><div id="historyRoster"></div></section>`;
    host.querySelectorAll("[data-member-tab]").forEach(button => button.onclick = () => {
      host.querySelectorAll("[data-member-tab]").forEach(item => item.classList.toggle("active", item === button));
      host.querySelectorAll("[data-member-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.memberPanel === button.dataset.memberTab));
    });
    const select = host.querySelector("#historySeason");
    const output = host.querySelector("#historyRoster");
    const drawHistoric = () => {
      const season = select.value;
      const team = historic[season].teams[slug];
      output.innerHTML = `<div class="ksb-roster-title"><h3>${escapeHtml(team.team.name)}</h3><span>${team.players.length} players</span></div>${historicGrid(team.players, season)}`;
    };
    if (select) { select.onchange = drawHistoric; drawHistoric(); }
  } catch (error) {
    host.className = "status-panel error";
    host.textContent = error.message;
  }
}

function fixtureValue(fixture, ...keys) {
  const key = keys.find(name => fixture?.[name] != null);
  return key ? fixture[key] : null;
}

function canonicalFixtureKey(season, fixture) {
  if (fixture?.fixtureKey) return fixture.fixtureKey;
  const week = fixtureValue(fixture, "weekId");
  const left = fixtureValue(fixture, "teamLeftSlug", "homeTeamSlug") || "";
  const right = fixtureValue(fixture, "teamRightSlug", "awayTeamSlug") || "";
  const fulfilled = fixtureValue(fixture, "timeFulfilled") || "";
  return `${season}|${week}|${left}|${right}|${fulfilled}`;
}

function normaliseEncounter(match) {
  const playerOnLeft = match.playerLeftSlug === match.playerSlug || match.playerLeftName === match.player;
  const playerScore = match.playerScore ?? (playerOnLeft ? match.scoreLeft : match.scoreRight);
  const opponentScore = match.opponentScore ?? (playerOnLeft ? match.scoreRight : match.scoreLeft);
  const opponent = match.opponent || (playerOnLeft ? match.playerRightName : match.playerLeftName);
  const opponentSlug = match.opponentSlug || (playerOnLeft ? match.playerRightSlug : match.playerLeftSlug);
  let result = match.result;
  if (!result && playerScore != null && opponentScore != null) result = Number(playerScore) > Number(opponentScore) ? "W" : Number(playerScore) < Number(opponentScore) ? "L" : "D";
  return {...match, playerScore, opponentScore, opponent, opponentSlug, result};
}

function renderEncounterRows(encounters) {
  if (!encounters.length) return `<p class="small-note mb-0">Individual results have not yet been included in the latest website data update.</p>`;
  const sorted = [...encounters].sort((a,b) => String(a.player).localeCompare(String(b.player)));
  return `<div class="table-responsive"><table class="table table-dark table-striped align-middle result-breakdown-table"><thead><tr><th class="text-start">KSB player</th><th class="text-start">Opponent</th><th>Score</th><th>Result</th></tr></thead><tbody>${sorted.map(raw => {
    const match = normaliseEncounter(raw);
    return `<tr><td class="text-start"><a href="player.html?id=${encodeURIComponent(match.playerSlug)}">${escapeHtml(match.player)}</a></td><td class="text-start">${escapeHtml(match.opponent || "Opponent not recorded")}</td><td>${match.playerScore ?? "-"}-${match.opponentScore ?? "-"}</td><td><span class="team-result-badge result-${String(match.result || "").toLowerCase()}">${escapeHtml(match.result || "-")}</span></td></tr>`;
  }).join("")}</tbody></table></div>`;
}

async function initialiseCurrentResults(database) {
  const tabs = document.querySelector(".nav-tabs");
  const tabContent = document.querySelector(".tab-content");
  if (!tabs || !tabContent || document.getElementById("results-tab")) return;
  const season = Number(database.coverage?.currentSeason || CURRENT_SEASON);
  const teamSlug = teamSlugs[teamName];
  const currentTeam = database.currentSeason?.teams?.[teamSlug];

  const tabItem = document.createElement("li");
  tabItem.className = "nav-item";
  tabItem.innerHTML = `<button class="nav-link" id="results-tab" data-bs-toggle="tab" data-bs-target="#results" type="button" role="tab">Results</button>`;
  const leagueItem = tabs.querySelector('[data-bs-target="#league"]')?.closest("li");
  leagueItem ? tabs.insertBefore(tabItem, leagueItem) : tabs.appendChild(tabItem);
  const pane = document.createElement("div");
  pane.className = "tab-pane fade";
  pane.id = "results";
  pane.setAttribute("role", "tabpanel");
  tabContent.appendChild(pane);

  const completed = (currentTeam?.fixtures || []).filter(fixture => fixture.scoreLeft != null && fixture.scoreRight != null);
  const players = currentTeam?.players || [];
  const encounters = players.flatMap(player => database.players?.[player.slug]?.seasons?.[String(season)]?.statistics?.encounters || []);
  const byFixture = new Map();
  encounters.forEach(raw => {
    const match = normaliseEncounter(raw);
    if (!match.fixtureKey) return;
    const list = byFixture.get(match.fixtureKey) || [];
    if (!list.some(existing => existing.id === match.id && existing.playerSlug === match.playerSlug)) list.push(match);
    byFixture.set(match.fixtureKey, list);
  });

  const cards = [...completed].sort((a,b) => Number(b.timeFulfilled || 0) - Number(a.timeFulfilled || 0)).map((fixture,index) => {
    const linked = byFixture.get(canonicalFixtureKey(season,fixture)) || [];
    const home = fixtureValue(fixture,"teamLeftName","homeTeamName") || "Home";
    const away = fixtureValue(fixture,"teamRightName","awayTeamName") || "Away";
    const homeScore = fixtureValue(fixture,"scoreLeft","homeScore");
    const awayScore = fixtureValue(fixture,"scoreRight","awayScore");
    const fulfilled = fixtureValue(fixture,"timeFulfilled");
    const parsedDate = fulfilled ? new Date(Number(fulfilled) * 1000) : null;
    const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "Date not recorded";
    return `<article class="team-result-card"><button class="team-result-summary" type="button" aria-expanded="false" aria-controls="result-detail-${index}"><span><small>${escapeHtml(date)}</small><strong>${escapeHtml(home)} ${homeScore} - ${awayScore} ${escapeHtml(away)}</strong></span><span class="result-expand">View match details</span></button><div class="team-result-detail" id="result-detail-${index}" hidden>${renderEncounterRows(linked)}</div></article>`;
  }).join("");

  pane.innerHTML = `<section class="team-results-panel"><div class="team-results-heading"><div><h2>${season} results</h2><p>Completed team matches and individual results from the current season.</p></div><span>${completed.length} completed</span></div>${cards || `<div class="current-season-empty"><h3>No team results recorded yet</h3><p>Results will appear after the scheduled data update following the first completed match.</p></div>`}</section>`;
  pane.addEventListener("click", event => {
    const button = event.target.closest(".team-result-summary");
    if (!button) return;
    const detail = document.getElementById(button.getAttribute("aria-controls"));
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    detail.hidden = open;
    button.querySelector(".result-expand").textContent = open ? "View match details" : "Hide match details";
  });
}

async function loadLeagueHistory() {
  const response = await fetch("league-history.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load league-history.json (${response.status}).`);
  const archive = await response.json();
  leagueData = archive.data || {};
  leagueStatuses = archive.statuses || {};
  CURRENT_SEASON = Number(archive.currentSeason || Math.max(...Object.keys(leagueData).map(Number))) || CURRENT_SEASON;
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

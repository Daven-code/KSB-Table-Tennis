// ===== team-template.js =====

// Ensure navbar and footer logos match site-utils styling
const navLogo = document.querySelector('.navbar-brand img');
if (navLogo) {
  navLogo.style.height = '40px';
  navLogo.style.marginRight = '8px';
}

const footerLogo = document.querySelector('footer img');
if (footerLogo) {
  footerLogo.style.height = '60px';
  footerLogo.style.marginBottom = '10px';
}

// Team mapping including Juniors
const teamUrls = {
  "KSB A":"ksb-a","KSB B":"ksb-b","KSB C":"ksb-c","KSB D":"ksb-d",
  "KSB E":"ksb-e","KSB F":"ksb-f","KSB G":"ksb-g",
  "KSB Lions":"ksb-lions","KSB Tigers (Jun)":"ksb-tigers-jun","KSB Jaguars":"ksb-jaguars",
  "KSB Leopards (Jun)":"ksb-leopards-jun","KSB Pumas (Jun)":"ksb-pumas-jun","KSB Panthers (Jun)":"ksb-panthers-jun"
};

// --- Team Members iframe ---
const slug = teamUrls[teamName] || "ksb-a";
const membersIframe = document.getElementById("membersIframe");
const membersLink = document.getElementById("membersLink");

if (membersIframe) membersIframe.src = `https://eastlancstt.org.uk/result/2025/team/${slug}`;
if (membersLink) membersLink.href = `https://eastlancstt.org.uk/result/2025/team/${slug}`;

// --- Load Fixtures from CSV specific to the team ---
const csvFileName = `${teamName} Fixtures.csv`; // e.g. "KSB A Fixtures.csv"

fetch(csvFileName)
  .then(res => res.text())
  .then(csv => {
    const rows = csv.trim().split('\n').map(r => r.split(','));
    const headers = ['Date','Home Team','Away Team','Venue'];
    const table = document.getElementById('fixturesTable');
    if (!table) return;

    // Table header
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });

    // Table body
    const tbody = table.createTBody();
    rows.slice(1).forEach(cols => {
      if (cols.includes(teamName)) {
        const tr = tbody.insertRow();
        [0,1,2,3,4,5].forEach(i => {
          const td = tr.insertCell();
          td.textContent = cols[i] ? cols[i].trim() : '';
        });
      }
    });

    // No fixtures fallback
    if (!tbody.rows.length) {
      const row = tbody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = headers.length;
      cell.textContent = 'No fixtures found for this team.';
      cell.classList.add('text-center');
    }
  })
  .catch(err => {
    console.error('Error loading fixtures:', err);
    const table = document.getElementById('fixturesTable');
    if (table) table.textContent = 'Unable to load fixtures.';
  });



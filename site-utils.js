// site-utils.js

// ===== CONFIGURATION =====
const siteConfig = {
  logo: 'Club_Badge.JPG',
  year: 2025,
  clubName: 'KSB Table Tennis Club',
  leagueText: 'Part of the East Lancashire Table Tennis League',
  navLinks: [
    {text: 'Home', href: 'index.html'},
    {text: 'Teams', href: 'teams.html'},
    {text: 'Contact Us', href: 'contact.html'},
    {text: 'League Info', href: 'league.html'},
    {text: 'News', href: 'news.html'}
  ],
  backgroundImages: Array.from({length:31}, (_,i)=>`background${i+1}.JPG`) // Background1.jpg ... Background28.jpg
};

// ===== RANDOM BACKGROUND =====
(function(){
  const images = siteConfig.backgroundImages;
  const randomImage = images[Math.floor(Math.random() * images.length)];
  document.body.style.backgroundImage = `url('${randomImage}')`;
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundPosition = 'center top';
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundAttachment = 'fixed';
})();

// ===== NAVBAR =====
(function(){
  const navbar = document.createElement('nav');
  navbar.className = 'navbar navbar-expand-lg navbar-dark';
  navbar.innerHTML = `
    <div class="container-fluid px-0"> 
      <a class="navbar-brand d-flex align-items-center" href="index.html" style="margin-left:12px;"> <!-- added margin -->
        <div style="background-color: rgba(255,255,255,0.85); padding: 3px 6px; border-radius:5px;">
          <img src="${siteConfig.logo}" alt="KSB Logo" style="height:40px;">
        </div>
        <span style="margin-left:8px; color:#f0f0f0; font-weight:bold;">${siteConfig.clubName}</span>
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse justify-content-end" id="navbarNav">
        <ul class="navbar-nav">
          ${siteConfig.navLinks.map(link=>`
            <li class="nav-item">
              <a class="btn btn-dark mx-1 py-1 px-3" href="${link.href}">${link.text}</a>
            </li>`).join('')}
        </ul>
      </div>
    </div>
  `;
  document.body.insertAdjacentElement('afterbegin', navbar);
})();


// ===== FOOTER =====
(function(){
  const footer = document.createElement('footer');
  footer.className = 'd-flex flex-column align-items-center mt-auto';
  footer.style.backgroundColor = '#1f1f1f';
  footer.style.color = '#999';
  footer.style.padding = '20px';
  footer.style.width = '100%';
  footer.innerHTML = `
    <div style="background-color: rgba(255,255,255,0.85); padding: 3px 6px; border-radius:5px; margin-bottom:10px;">
      <img src="${siteConfig.logo}" alt="KSB Logo" style="height:60px;">
    </div>
    &copy; ${siteConfig.year} ${siteConfig.clubName} | ${siteConfig.leagueText}
  `;
  document.body.appendChild(footer);

  // Ensure body is at least full height to push footer down
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';
  document.body.style.minHeight = '100vh';
})();


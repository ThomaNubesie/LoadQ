/* LoadQ marketing site — shared JS */
(function(){
  // Live clock
  function tick(){
    const d = new Date();
    const locale = document.documentElement.lang === 'fr' ? 'fr-CA' : 'en-CA';
    const t = d.toLocaleTimeString(locale, {hour12:false});
    document.querySelectorAll('[data-clock]').forEach(el => el.textContent = 'SYS · ' + t);
  }
  tick(); setInterval(tick, 1000);

  // Reveal on scroll
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('h2, .promise, .step, .city, .board, .phone, .dl-card, .safe-card, .stat, .earn-card, article.prose').forEach(el => {
    el.classList.add('reveal'); io.observe(el);
  });

  // Live car-count updates (only if board present)
  const carsEls = document.querySelectorAll('.board-row .cars');
  if (carsEls.length){
    setInterval(() => {
      const idx = Math.floor(Math.random() * carsEls.length);
      const el = carsEls[idx];
      let n = parseInt(el.textContent, 10);
      const delta = Math.random() > 0.5 ? 1 : -1;
      n = Math.max(1, Math.min(15, n + delta));
      el.textContent = String(n).padStart(2, '0');
      el.style.color = '#ffa530';
      setTimeout(() => { el.style.color = ''; }, 400);
    }, 3500);
  }

  // Mobile menu
  document.querySelectorAll('.menu-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const ul = btn.parentElement.querySelector('ul');
      if (ul) ul.classList.toggle('show');
    });
  });

  // QR codes — call window.makeLoadQR(elId, url)
  window.makeLoadQR = function(elId, url){
    const el = document.getElementById(elId);
    if (!el) return;
    if (window.QRCode && window.QRCode.toCanvas){
      const c = document.createElement('canvas');
      el.appendChild(c);
      window.QRCode.toCanvas(c, url, {
        errorCorrectionLevel:'H', margin:1, scale:8,
        color:{ dark:'#0F0A00', light:'#F5F5F5' }
      });
    } else {
      const img = document.createElement('img');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=H&color=0F0A00&bgcolor=F5F5F5&data=' + encodeURIComponent(url);
      el.appendChild(img);
    }
  };

  // Auto-render any element with data-qr
  window.addEventListener('load', () => {
    document.querySelectorAll('[data-qr]').forEach(el => {
      window.makeLoadQR(el.id, el.getAttribute('data-qr'));
    });
  });
})();

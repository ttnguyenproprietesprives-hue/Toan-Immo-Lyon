// Script commun à toutes les pages publiques de Toan Immo Lyon :
// mesure d'audience Vercel (sans cookie), provenance des visiteurs, compteurs de clics
// et barre d'action fixe en bas de l'écran sur mobile.
(function () {
  var TEL = '0660022725';
  var WHATSAPP = '33660022725';
  var MESSAGE_WA = "Bonjour Toan, je souhaite des informations sur mon projet immobilier.";

  // 1. Mesure d'audience Vercel Web Analytics (à activer dans Vercel : onglet Analytics)
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var va = document.createElement('script');
  va.defer = true;
  va.src = '/_vercel/insights/script.js';
  document.head.appendChild(va);

  // 2. Provenance : mémorisée à la première page vue de la visite, jointe aux leads
  function lireSource() {
    try { return sessionStorage.getItem('ti_source') || ''; } catch (e) { return ''; }
  }
  if (!lireSource()) {
    var params = new URLSearchParams(location.search);
    var origine = params.get('utm_source') || '';
    if (!origine && document.referrer) {
      try {
        var h = new URL(document.referrer).hostname.replace(/^www\./, '');
        if (h.indexOf('toanimmo-lyon.fr') === -1) origine = h;
      } catch (e) {}
    }
    var campagne = params.get('utm_campaign');
    var source = (origine || 'accès direct') + (campagne ? ' / ' + campagne : '') + ' → ' + location.pathname;
    try { sessionStorage.setItem('ti_source', source.slice(0, 180)); } catch (e) {}
  }

  // 3. Compteurs anonymes
  function suivre(evenement) {
    try {
      var donnees = JSON.stringify({ e: evenement });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', donnees);
      else fetch('/api/track', { method: 'POST', body: donnees, keepalive: true });
    } catch (e) {}
  }
  window.TI = { source: lireSource, suivre: suivre };

  document.addEventListener('click', function (ev) {
    var lien = ev.target.closest && ev.target.closest('a[href]');
    if (!lien) return;
    var href = lien.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) suivre('clic_tel');
    else if (href.indexOf('wa.me') !== -1) suivre('clic_whatsapp');
    else if (href.indexOf('calendly.com') !== -1) suivre('clic_rdv');
  }, true);

  // 4. Barre d'action mobile (pas sur les pages d'administration)
  if (/admin|generateur|tableau-de-bord/.test(location.pathname)) return;
  var estimer = location.pathname === '/' ? '#estimation' : '/#estimation';
  var style = document.createElement('style');
  style.textContent =
    '.ti-barre{display:none}' +
    '@media(max-width:700px){' +
    '.ti-barre{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:9000;background:#0F1E33;border-top:1px solid rgba(201,168,76,.35);padding:8px 8px calc(8px + env(safe-area-inset-bottom));gap:8px}' +
    '.ti-barre a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 4px;border-radius:10px;text-decoration:none;font-family:"DM Sans",sans-serif;font-size:12px;font-weight:500;color:#fff;background:rgba(255,255,255,.08)}' +
    '.ti-barre a span{font-size:18px;line-height:1}' +
    '.ti-barre a.ti-estimer{background:#C9A84C;color:#0F1E33}' +
    'body{padding-bottom:76px}}';
  document.head.appendChild(style);

  function ajouterBarre() {
    var barre = document.createElement('nav');
    barre.className = 'ti-barre';
    barre.setAttribute('aria-label', 'Contacter Toan');
    barre.innerHTML =
      '<a href="tel:' + TEL + '"><span>📞</span>Appeler</a>' +
      '<a href="https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(MESSAGE_WA) + '" target="_blank" rel="noopener"><span>💬</span>WhatsApp</a>' +
      '<a class="ti-estimer" href="' + estimer + '"><span>🏠</span>Estimer</a>';
    document.body.appendChild(barre);
  }
  if (document.body) ajouterBarre(); else document.addEventListener('DOMContentLoaded', ajouterBarre);
})();

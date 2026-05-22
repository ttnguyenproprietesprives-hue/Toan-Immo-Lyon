import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prospect, estimation, bien } = req.body;

  try {
    await resend.emails.send({
      from: 'Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>',
      to: prospect.email,
      subject: `Votre estimation – ${bien.adresse ? bien.adresse + ', ' : ''}${bien.commune} – Toan Immo Lyon`,
      html: `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif}
  .wrap{max-width:600px;margin:0 auto;background:#fff}
  .hero{background:#1A2E4A;padding:32px 32px 24px;text-align:center}
  .logo{font-size:13px;color:rgba(255,255,255,0.5);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:20px}
  .price{font-size:48px;font-weight:300;color:#C9A84C;margin:8px 0 4px}
  .range{font-size:13px;color:rgba(255,255,255,0.45)}
  .salut{font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em}
  .metrics{display:flex;border-top:1px solid rgba(255,255,255,0.08);margin-top:20px}
  .metric{flex:1;padding:14px;text-align:center;border-right:1px solid rgba(255,255,255,0.08)}
  .metric:last-child{border-right:none}
  .mv{font-size:16px;font-weight:500;color:#fff}
  .ml{font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.06em;margin-top:3px}
  .body{padding:28px 32px}
  .analyse{font-size:14px;color:#7A7670;line-height:1.75;margin-bottom:20px}
  .cols{display:flex;gap:20px;margin-bottom:20px}
  .col{flex:1}
  .col-title{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:10px}
  .forts .col-title{color:#1D9E75}
  .vigil .col-title{color:#C9A84C}
  .col ul{margin:0;padding:0;list-style:none}
  .col li{font-size:13px;color:#7A7670;padding:3px 0;display:flex;gap:7px;line-height:1.5}
  .conseil{padding:14px 16px;border-left:3px solid #C9A84C;background:#FBF8F0;border-radius:0 6px 6px 0;margin-bottom:24px}
  .c-lbl{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#C9A84C;font-weight:600;margin-bottom:4px}
  .c-txt{font-size:13px;color:#3D3B38;line-height:1.6}
  .cta-block{text-align:center;background:#F8F7F5;border-radius:8px;padding:24px;margin-bottom:24px}
  .cta-block p{font-size:13px;color:#7A7670;margin:0 0 16px}
  .btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .btn{display:inline-block;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:500;text-decoration:none}
  .btn-phone{background:#1A2E4A;color:#fff}
  .btn-rdv{background:#C9A84C;color:#0F1E33}
  .recap{background:#F8F7F5;border-radius:6px;padding:16px 20px;margin-bottom:20px}
  .recap-title{font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#B8B4AC;font-weight:500;margin-bottom:10px}
  .recap-grid{display:flex;flex-wrap:wrap;gap:6px 20px}
  .recap-item{font-size:12px;color:#7A7670}
  .recap-item strong{color:#3D3B38}
  .footer{background:#0F1E33;padding:20px 32px;text-align:center}
  .footer p{font-size:11px;color:rgba(255,255,255,0.3);line-height:1.8;margin:0}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="logo">Toan Immo Lyon · Estimation immobilière</div>
    <div class="salut">Bonjour ${prospect.civilite} ${prospect.prenom} ${prospect.nom}</div>
    <div class="price">${estimation.prix_formate} <span style="font-size:24px">${estimation.unite}</span></div>
    <div class="range">Fourchette réaliste : ${estimation.min_formate} – ${estimation.max_formate} ${estimation.unite}</div>
    <div class="metrics">
      <div class="metric"><div class="mv">${estimation.prix_m2_formate} €</div><div class="ml">Prix / m²</div></div>
      <div class="metric"><div class="mv">${estimation.nb_similaires || '~10'}</div><div class="ml">Annonces similaires</div></div>
      <div class="metric"><div class="mv">${estimation.delai || '–'}</div><div class="ml">Délai moyen</div></div>
    </div>
  </div>
  <div class="body">
    <p class="analyse">${estimation.analyse}</p>
    <div class="cols">
      <div class="col forts">
        <div class="col-title">Points forts</div>
        <ul>${(estimation.points_forts || []).map(p => `<li><span style="color:#1D9E75;font-weight:500">✓</span>${p}</li>`).join('')}</ul>
      </div>
      <div class="col vigil">
        <div class="col-title">Points de vigilance</div>
        <ul>${(estimation.vigilances || []).map(p => `<li><span style="color:#C9A84C;font-size:18px;line-height:1">·</span>${p}</li>`).join('')}</ul>
      </div>
    </div>
    ${estimation.conseil ? `<div class="conseil"><div class="c-lbl">Conseil de Toan</div><div class="c-txt">${estimation.conseil}</div></div>` : ''}
    <div class="cta-block">
      <p>Vous souhaitez aller plus loin ? Je suis disponible pour un avis de valeur complet et gratuit.</p>
      <div class="btns">
        <a href="tel:0660022725" class="btn btn-phone">📞 06 60 02 27 25</a>
        <a href="https://calendly.com/tt-nguyen-proprietesprivees/rendez-vous-estimation-vente-achat" class="btn btn-rdv">📅 Prendre RDV</a>
      </div>
    </div>
    <div class="recap">
      <div class="recap-title">Récapitulatif de votre bien</div>
      <div class="recap-grid">
        <div class="recap-item"><strong>Projet :</strong> ${bien.projet}</div>
        <div class="recap-item"><strong>Bien :</strong> ${bien.type} – ${bien.pieces} pièces</div>
        <div class="recap-item"><strong>Surface :</strong> ${bien.surface} m²</div>
        <div class="recap-item"><strong>Commune :</strong> ${bien.commune}</div>
        ${bien.adresse ? `<div class="recap-item"><strong>Adresse :</strong> ${bien.adresse}</div>` : ''}
        <div class="recap-item"><strong>État :</strong> ${bien.etat}</div>
        <div class="recap-item"><strong>DPE :</strong> ${bien.dpe}</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <p><strong style="color:rgba(255,255,255,0.6)">Toan Immo Lyon</strong> · NGUYEN Trung Toan · Conseiller immobilier indépendant<br/>
    Réseau Propriétés-Privées · SIRET 889 789 186 00018<br/>
    Cette estimation est fournie à titre indicatif sur la base des données de marché disponibles.</p>
  </div>
</div>
</body></html>`
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Resend error:', err);
    res.status(500).json({ error: err.message });
  }
}

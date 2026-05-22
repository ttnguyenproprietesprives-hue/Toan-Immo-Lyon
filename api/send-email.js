export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { prospect, estimation, bien } = body;

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Votre estimation immobilière – Toan Immo Lyon</title>
</head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7F5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr><td style="background:#0F1E33;border-radius:12px 12px 0 0;padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:40px;height:40px;background:#C9A84C;border-radius:50%;text-align:center;vertical-align:middle;">
                      <span style="font-family:Georgia,serif;font-size:15px;font-weight:bold;color:#0F1E33;">TI</span>
                    </td>
                    <td style="padding-left:12px;">
                      <div style="font-family:Georgia,serif;font-size:17px;color:#ffffff;font-weight:500;">Toan Immo Lyon</div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;">Conseiller immobilier · Grand Lyon</div>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right">
                <span style="font-size:11px;color:#C9A84C;border:1px solid rgba(201,168,76,0.4);padding:5px 12px;border-radius:99px;">Estimation gratuite</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- HERO ESTIMATION -->
        <tr><td style="background:#1A2E4A;padding:32px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin-bottom:8px;">
            Bonjour ${prospect.civilite} ${prospect.prenom} ${prospect.nom} · Estimation ${estimation.unite === '€/mois' ? 'locative' : 'vénale'} · ${bien.commune}
          </div>
          <div style="font-family:Georgia,serif;font-size:42px;color:#C9A84C;font-weight:400;margin-bottom:4px;">
            ${estimation.prix_formate} <span style="font-size:22px;">${estimation.unite}</span>
          </div>
          <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:24px;">
            Fourchette réaliste : ${estimation.min_formate} – ${estimation.max_formate} ${estimation.unite}
          </div>

          <!-- METRICS -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;">
            <tr>
              <td width="33%" align="center" style="border-right:1px solid rgba(255,255,255,0.08);padding:12px 0;">
                <div style="font-size:18px;font-weight:500;color:#ffffff;">${estimation.prix_m2_formate} €</div>
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.35);margin-top:3px;">Prix / m²</div>
              </td>
              <td width="33%" align="center" style="border-right:1px solid rgba(255,255,255,0.08);padding:12px 0;">
                <div style="font-size:18px;font-weight:500;color:#ffffff;">${estimation.nb_similaires || '~10'}</div>
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.35);margin-top:3px;">Annonces similaires</div>
              </td>
              <td width="33%" align="center" style="padding:12px 0;">
                <div style="font-size:18px;font-weight:500;color:#ffffff;">${estimation.delai || '–'}</div>
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.35);margin-top:3px;">Délai moyen</div>
              </td>
            </tr>
          </table>

          <!-- BADGES -->
          <div style="margin-top:16px;">
            <span style="font-size:11px;padding:4px 12px;border-radius:99px;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.55);margin-right:8px;">
              Confiance ${estimation.confiance}
            </span>
            <span style="font-size:11px;padding:4px 12px;border-radius:99px;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.55);">
              Marché : ${estimation.tendance}
            </span>
          </div>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#ffffff;padding:32px;">

          <!-- ANALYSE -->
          <p style="font-size:14px;color:#7A7670;line-height:1.75;margin:0 0 24px;">${estimation.analyse}</p>

          <!-- POINTS FORTS -->
          ${estimation.points_forts && estimation.points_forts.length > 0 ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td width="48%" valign="top" style="padding-right:16px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1D9E75;font-weight:500;margin-bottom:10px;">Points forts</div>
                ${estimation.points_forts.map(p => `
                <div style="font-size:13px;color:#7A7670;padding:3px 0;display:flex;align-items:flex-start;">
                  <span style="color:#1D9E75;margin-right:8px;font-weight:500;">✓</span> ${p}
                </div>`).join('')}
              </td>
              <td width="4%"></td>
              <td width="48%" valign="top">
                ${estimation.vigilances && estimation.vigilances.length > 0 ? `
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#C9A84C;font-weight:500;margin-bottom:10px;">Points de vigilance</div>
                ${estimation.vigilances.map(p => `
                <div style="font-size:13px;color:#7A7670;padding:3px 0;">
                  <span style="color:#C9A84C;margin-right:8px;">·</span> ${p}
                </div>`).join('')}` : ''}
              </td>
            </tr>
          </table>` : ''}

          <!-- CONSEIL -->
          ${estimation.conseil ? `
          <div style="padding:14px 16px;border-left:3px solid #C9A84C;background:#FBF8F0;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#C9A84C;font-weight:500;margin-bottom:4px;">Conseil de Toan</div>
            <p style="font-size:13px;color:#3D3B38;line-height:1.6;margin:0;">${estimation.conseil}</p>
          </div>` : ''}

          <!-- RÉCAPITULATIF -->
          <div style="background:#F8F7F5;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#B8B4AC;font-weight:500;margin-bottom:12px;">Récapitulatif de votre bien</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">Projet :</strong> ${bien.projet}</td>
                <td width="50%" style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">Bien :</strong> ${bien.type} – ${bien.pieces} pièces</td>
              </tr>
              <tr>
                <td style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">Surface :</strong> ${bien.surface} m²</td>
                <td style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">Commune :</strong> ${bien.commune}</td>
              </tr>
              ${bien.adresse ? `<tr><td colspan="2" style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">Adresse :</strong> ${bien.adresse}</td></tr>` : ''}
              <tr>
                <td style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">État :</strong> ${bien.etat}</td>
                <td style="font-size:12px;color:#7A7670;padding:3px 0;"><strong style="color:#3D3B38;">DPE :</strong> ${bien.dpe}</td>
              </tr>
            </table>
          </div>

          <!-- DISCLAIMER -->
          <p style="font-size:11px;color:#B8B4AC;line-height:1.6;margin:0 0 24px;">
            Cette estimation est fournie à titre indicatif, basée sur les données réelles du marché (DVF, LeBonCoin, PAP, SeLoger). Elle ne constitue pas une expertise immobilière au sens légal. Pour un avis de valeur précis après visite de votre bien, contactez-moi directement.
          </p>

          <hr style="border:none;border-top:1px solid #EEECE8;margin:0 0 24px;" />

          <!-- CTA -->
          <div style="background:#FBF8F0;border-radius:12px;padding:24px;text-align:center;border:1px solid rgba(201,168,76,0.2);">
            <div style="font-family:Georgia,serif;font-size:1.1rem;color:#1A2E4A;margin-bottom:6px;">Vous souhaitez aller plus loin ?</div>
            <p style="font-size:13px;color:#7A7670;margin:0 0 20px;line-height:1.6;">
              Je vous propose une visite gratuite de votre bien et un rapport d'estimation détaillé sous 24h.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td style="padding-right:10px;">
                  <a href="tel:0660022725" style="display:inline-block;padding:13px 20px;background:#1A2E4A;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
                    📞 06 60 02 27 25
                  </a>
                </td>
                <td>
                  <a href="https://calendly.com/tt-nguyen-proprietesprivees/rendez-vous-estimation-vente-achat" style="display:inline-block;padding:13px 20px;background:#C9A84C;color:#0F1E33;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
                    📅 Prendre RDV en ligne
                  </a>
                </td>
              </tr>
            </table>
          </div>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#0F1E33;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.8;">
            <strong style="color:#C9A84C;">Toan Immo Lyon</strong> · NGUYEN Trung Toan<br/>
            Conseiller immobilier indépendant · Réseau Propriétés-Privées<br/>
            SIRET 889 789 186 00018 · Carte T n°CPI 4401 2016 000 010 388<br/>
            <a href="https://www.toanimmo-lyon.fr" style="color:#C9A84C;text-decoration:none;">www.toanimmo-lyon.fr</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>',
        to: [prospect.email],
        subject: `Votre estimation – ${bien.adresse ? bien.adresse + ', ' : ''}${bien.commune} – Toan Immo Lyon`,
        html: html
      })
    });

    const result = await response.json();
    res.status(200).json({ ok: true, result });
  } catch(e) {
    res.status(200).json({ ok: true, error: e.message });
  }
}

// Relances automatiques par email des personnes ayant fait une estimation en ligne
// ET accepté de recevoir des emails (case facultative du formulaire).
//
// Trois usages de cette route :
//  - envoi quotidien : appelé chaque matin par Vercel Cron (voir vercel.json), protégé par CRON_SECRET ;
//  - désinscription : lien présent dans chaque email (?desinscription=<id>&jeton=<jeton>) ;
//  - test manuel depuis l'admin : ?test=<id>&etape=1..4 avec le mot de passe admin.
import { Resend } from 'resend';
import { isAdmin } from './_auth.js';
import { esc } from './_util.js';
import { redis, compter, CALENDRIER_RELANCES } from './_leads.js';
import { PRIX, ANNEE_PRIX } from './_prix.js';

const SITE = 'https://www.toanimmo-lyon.fr';
const CALENDLY = 'https://calendly.com/tt-nguyen-proprietesprivees/rendez-vous-estimation-vente-achat';
const TEL = '06 60 02 27 25';
const JOUR = 864e5;
// Statuts du tableau de bord qui arrêtent les relances (le contact est déjà engagé ou terminé)
const STOP = ['rdv', 'mandat', 'vendu', 'perdu'];

const fmt = n => Number(n).toLocaleString('fr-FR');

function lienDesinscription(fiche) {
  return `${SITE}/api/relances?desinscription=${fiche.id}&jeton=${fiche.relance.jeton}`;
}

function gabarit(fiche, titre, corps) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EEECE8;">
  <div style="background:#1A2E4A;padding:22px 28px;">
    <div style="color:#C9A84C;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Toan Immo Lyon · Est lyonnais</div>
    <div style="color:#fff;font-size:21px;font-family:Georgia,serif;margin-top:6px;">${esc(titre)}</div>
  </div>
  <div style="padding:24px 28px;font-size:15px;line-height:1.7;color:#3D3B38;">
    ${corps}
    <div style="margin:26px 0 8px;">
      <a href="${CALENDLY}" style="display:inline-block;background:#C9A84C;color:#0F1E33;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;margin:0 8px 8px 0;">📅 Prendre rendez-vous</a>
      <a href="tel:${TEL.replace(/\s/g, '')}" style="display:inline-block;background:#1A2E4A;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;margin:0 0 8px;">📞 ${TEL}</a>
    </div>
    <p style="margin:18px 0 0;">Bien à vous,<br/><strong>Toam Nguyen</strong><br/><span style="color:#7A7670;font-size:13px;">Conseiller immobilier · Réseau Propriétés-Privées · Est lyonnais</span></p>
  </div>
  <div style="background:#F8F7F5;padding:14px 28px;font-size:11px;color:#B8B4AC;line-height:1.6;">
    Vous recevez cet email car vous avez demandé une estimation sur toanimmo-lyon.fr et accepté de recevoir des conseils par email.
    <a href="${lienDesinscription(fiche)}" style="color:#7A7670;">Se désinscrire en un clic</a>.<br/>
    Toan Immo Lyon · NGUYEN Trung Toam · Conseiller immobilier indépendant · Réseau Propriétés-Privées · SIRET 889 789 186 00018
  </div>
</div></body></html>`;
}

// Contenu des 4 emails (n = 1 à 4)
function contenu(fiche, n) {
  const prenom = esc(fiche.prenom || '');
  const commune = (fiche.commune || '').split(' (')[0];
  const c = esc(commune || 'votre commune');
  const est = fiche.estimation;
  const ref = PRIX[fiche.commune];
  const pageCommune = ref ? `${SITE}/${ref.page}` : SITE;
  const lienCommune = `<a href="${pageCommune}" style="color:#1A2E4A;">les prix et les quartiers de ${c}</a>`;

  if (n === 1) {
    const rappel = est
      ? `<p>Pour rappel, notre outil a estimé votre ${esc(est.type_bien || 'bien')} de ${esc(est.surface)} m² à environ <strong>${fmt(est.prix)} €</strong> (fourchette de ${fmt(est.min)} à ${fmt(est.max)} €).</p>`
      : '';
    return {
      sujet: `Votre estimation à ${commune || 'Lyon'} : avez-vous des questions ?`,
      html: gabarit(fiche, 'Votre estimation : et maintenant ?', `
        <p>Bonjour ${prenom},</p>
        <p>Vous avez réalisé il y a quelques jours une estimation de votre bien à ${c} sur mon site, et je vous en remercie.</p>
        ${rappel}
        <p>Cette estimation en ligne reste <strong>indicative</strong> : elle ne voit ni l'état réel de votre bien, ni sa luminosité, ni son environnement immédiat. Ce sont pourtant ces détails qui font souvent la différence sur le prix de vente.</p>
        <p>Si vous le souhaitez, je peux passer réaliser un <strong>avis de valeur précis, gratuit et sans engagement</strong>, à partir des ventes récentes de votre secteur. Une simple réponse à cet email suffit pour en discuter.</p>`),
    };
  }
  if (n === 2) {
    return {
      sujet: `3 conseils pour vendre au meilleur prix à ${commune || 'Lyon'}`,
      html: gabarit(fiche, '3 conseils pour bien vendre', `
        <p>Bonjour ${prenom},</p>
        <p>Que votre projet soit pour bientôt ou pour plus tard, voici les trois points qui, d'expérience, pèsent le plus sur le prix et le délai de vente :</p>
        <p><strong>1. Le juste prix dès le départ.</strong> Un bien affiché trop cher attire peu de visites, puis finit souvent par se vendre en dessous de sa valeur. Les premières semaines de mise en vente sont les plus précieuses.</p>
        <p><strong>2. Les diagnostics, et le DPE en particulier.</strong> Les acheteurs le regardent de très près. Le connaître à l'avance permet d'anticiper leurs questions et de défendre votre prix.</p>
        <p><strong>3. La présentation.</strong> Des photos lumineuses et un bien désencombré donnent envie de visiter. Quelques petits travaux bien choisis peuvent suffire.</p>
        <p>Pour mieux connaître votre secteur, vous pouvez consulter ${lienCommune}.</p>`),
    };
  }
  if (n === 3) {
    const fourchette = ref && ref.appartement
      ? `<p>À titre indicatif, je retiens en ${ANNEE_PRIX} pour ${c} une fourchette de <strong>${fmt(ref.appartement[0])} à ${fmt(ref.appartement[1])} €/m²</strong> pour un appartement${ref.maison ? ` et de <strong>${fmt(ref.maison[0])} à ${fmt(ref.maison[1])} €/m²</strong> pour une maison` : ''}.</p>`
      : '';
    return {
      sujet: `Le marché immobilier à ${commune || 'Lyon'} : où en est votre projet ?`,
      html: gabarit(fiche, 'Où en est votre projet ?', `
        <p>Bonjour ${prenom},</p>
        <p>Cela fait maintenant un mois que vous avez estimé votre bien à ${c}. Je voulais prendre de vos nouvelles : votre projet a-t-il avancé ?</p>
        ${fourchette}
        <p>Chaque bien reste unique, et une visite permet d'affiner fortement cette fourchette. Si vous voulez faire le point, même sans projet immédiat, je suis disponible pour en parler.</p>
        <p>Vous pouvez aussi <a href="${SITE}/#estimation" style="color:#1A2E4A;">refaire une estimation en ligne</a> à tout moment.</p>`),
    };
  }
  return {
    sujet: 'Votre projet immobilier : faisons le point',
    html: gabarit(fiche, 'Faisons le point', `
      <p>Bonjour ${prenom},</p>
      <p>Il y a trois mois, vous aviez estimé votre bien à ${c}. Ceci est mon dernier message automatique : je ne vous écrirai plus ensuite, sauf si vous me recontactez.</p>
      <p>Le jour où votre projet de vente se concrétisera, je serai heureux de vous accompagner, de l'avis de valeur jusqu'à la signature chez le notaire, avec une méthode claire et sans jargon.</p>
      <p>Il suffit de répondre à cet email ou de m'appeler.</p>`),
  };
}

async function envoyer(fiche, n) {
  const { sujet, html } = contenu(fiche, n);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Toam Nguyen – Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>',
    to: fiche.email,
    reply_to: 'tt-nguyen@proprietes-privees.com',
    subject: sujet,
    html,
    headers: { 'List-Unsubscribe': `<${lienDesinscription(fiche)}>` },
  });
  if (error) throw new Error(error.message || 'Resend');
}

function pageMessage(titre, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>${titre}</title></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F8F7F5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;">
<div style="background:#fff;border-radius:12px;padding:40px 32px;max-width:440px;text-align:center;border:1px solid #EEECE8;">
<h1 style="font-family:Georgia,serif;color:#1A2E4A;font-size:22px;margin:0 0 12px;">${titre}</h1><p style="color:#7A7670;font-size:15px;line-height:1.6;margin:0 0 20px;">${message}</p>
<a href="${SITE}" style="color:#1A2E4A;font-size:14px;">Retour au site Toan Immo Lyon</a></div></body></html>`;
}

export default async function handler(req, res) {
  const r = redis();
  if (!r) return res.status(500).json({ error: 'Base Upstash non configurée' });
  const { desinscription, jeton, test, etape } = req.query;

  // 1. Désinscription en un clic (lien public présent dans chaque email)
  if (desinscription) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const id = String(desinscription);
    const fiche = /^[a-z0-9]+$/.test(id) ? await r.get(`lead:${id}`) : null;
    if (!fiche || !fiche.relance || fiche.relance.jeton !== jeton) {
      return res.status(404).send(pageMessage('Lien invalide', 'Ce lien de désinscription n\'est pas valide ou a expiré.'));
    }
    if (fiche.relance.active) {
      fiche.relance.active = false;
      fiche.relance.desinscrit = new Date().toISOString();
      await r.set(`lead:${id}`, fiche, { keepTtl: true });
      await r.srem('relances:actives', id);
      await compter('relance_desinscription');
    }
    return res.status(200).send(pageMessage('Vous êtes désinscrit', 'Vous ne recevrez plus d\'emails de ma part. Merci de votre visite, et à bientôt peut-être.'));
  }

  // Les autres usages sont réservés au planificateur Vercel (CRON_SECRET) ou à l'admin
  const parCron = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!parCron && !isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY manquante' });

  // 2. Test manuel : envoie immédiatement l'email n° etape au lead indiqué, sans toucher au calendrier
  if (test) {
    const fiche = await r.get(`lead:${test}`);
    const n = Number(etape) || 1;
    if (!fiche || !fiche.relance || n < 1 || n > 4) return res.status(400).json({ error: 'Lead sans relance, ou étape invalide (1 à 4)' });
    await envoyer(fiche, n);
    return res.status(200).json({ ok: true, envoye: `email ${n} à ${fiche.email}` });
  }

  // 3. Envoi quotidien : chaque relance arrivée à échéance
  const ids = await r.smembers('relances:actives');
  const bilan = { verifies: ids.length, envoyes: 0, arretes: 0, erreurs: 0 };
  for (const id of ids) {
    const fiche = await r.get(`lead:${id}`);
    if (!fiche || !fiche.relance || !fiche.relance.active) { await r.srem('relances:actives', id); continue; }
    if (STOP.includes(fiche.statut)) {
      fiche.relance.active = false;
      fiche.relance.arret = `statut « ${fiche.statut} »`;
      await r.set(`lead:${id}`, fiche, { keepTtl: true });
      await r.srem('relances:actives', id);
      bilan.arretes++;
      continue;
    }
    if (fiche.relance.prochaine > Date.now()) continue;
    try {
      const n = fiche.relance.etape + 1;
      await envoyer(fiche, n);
      fiche.relance.etape = n;
      fiche.relance.dernier = new Date().toISOString();
      if (n >= CALENDRIER_RELANCES.length) {
        fiche.relance.active = false;
        await r.srem('relances:actives', id);
      } else {
        fiche.relance.prochaine = new Date(fiche.date).getTime() + CALENDRIER_RELANCES[n] * JOUR;
      }
      await r.set(`lead:${id}`, fiche, { keepTtl: true });
      await compter('relance_envoyee');
      bilan.envoyes++;
    } catch (e) {
      console.error('relance', id, e.message);
      bilan.erreurs++;
    }
  }
  console.log('relances :', bilan);
  res.status(200).json(bilan);
}

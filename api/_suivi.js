// Suivi des visites (confirmations, bons de visite électroniques, avis des visiteurs, comptes rendus
// aux vendeurs) et fidélisation des anciens clients (messages automatiques, relances).
// Non exposé comme route (préfixe "_") : branché sur /api/leads (admin) et /api/relances (public + cron).
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { parseBody, esc, clip, limiteAtteinte } from './_util.js';
import { compter, moisCle } from './_leads.js';

const SITE = 'https://www.toanimmo-lyon.fr';
const TEL = '06 60 02 27 25';
const EXPEDITEUR = 'Toam Nguyen – Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>';
const REPONSE = 'tt-nguyen@proprietes-privees.com';
const LIEN_AVIS_GOOGLE = 'https://g.page/r/CWXo7roLQ-gZEAE/review';
const MENTIONS = 'Toan Immo Lyon · NGUYEN Trung Toam · Conseiller immobilier indépendant · Réseau Propriétés-Privées · SIRET 889 789 186 00018';
const JOUR = 864e5;
const TROIS_ANS = 3 * 365 * 24 * 3600;
// Nombre d'anniversaires de signature fêtés avant l'arrêt automatique des messages
export const ANNEES_SUIVI = 10;
const DUREE_CLIENT = (ANNEES_SUIVI + 1) * 365 * 24 * 3600;

const ID = /^[a-z0-9]+$/;
const emailValide = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nouveauJeton = () => randomBytes(12).toString('hex');
const fmt = n => Number(n).toLocaleString('fr-FR');

const PRIX_PERCU = { trop_eleve: 'trop élevé', coherent: 'cohérent', attractif: 'attractif' };
const INTENTIONS = { offre: 'souhaite faire une offre', revisite: 'souhaite une seconde visite', reflexion: 'réfléchit encore', non: 'ne donne pas suite' };

// ───────────── Texte du bon de visite (à adapter si votre réseau impose une formulation) ─────────────
function texteBon(v) {
  const b = v.bien;
  const nom = `${v.visiteur.prenom} ${v.visiteur.nom}`.trim();
  return [
    `Je soussigné(e) ${nom} reconnais visiter, le ${dateTexte(v.quand)}, par l'intermédiaire de M. NGUYEN Trung Toam, conseiller immobilier indépendant du réseau Propriétés-Privées, le bien suivant :`,
    `${b.titre}${b.adresse ? ' – ' + b.adresse : ''}${b.commune ? ', ' + b.commune : ''}${b.prix ? ` – présenté au prix de ${fmt(b.prix)} €` : ''}${b.mandat ? ` (mandat n° ${b.mandat})` : ''}.`,
    'Je reconnais que ce bien m\'a été présenté pour la première fois par son intermédiaire.',
    'Je m\'engage à ne pas traiter l\'achat de ce bien, directement ou indirectement, avec le propriétaire ou par un autre intermédiaire, sans le concours de M. NGUYEN Trung Toam, pendant la durée de son mandat.',
    'Ce bon de visite ne constitue ni une offre d\'achat ni un engagement d\'acquérir.',
  ];
}

// ───────────── Dates (tout est raisonné en heure de Paris, au format AAAA-MM-JJTHH:MM) ─────────────
function maintenantParis() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T').slice(0, 16);
}
function decalerJour(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}
function decalerAnnee(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a + n, m - 1, j)).toISOString().slice(0, 10);
}
// « samedi 14 novembre 2026 à 15h30 »
function dateTexte(quand) {
  const [jour, heure = ''] = String(quand).split('T');
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return heure ? `${d} à ${heure.slice(0, 5).replace(':', 'h')}` : d;
}
// Accepte AAAA-MM-JJ ou JJ/MM/AAAA, renvoie AAAA-MM-JJ ou ''
function lireDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { const f = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/); if (f) m = [0, f[3], f[2].padStart(2, '0'), f[1].padStart(2, '0')]; }
  if (!m) return '';
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : '';
}
function lienAgenda(v) {
  const [jour, heure] = v.quand.split('T');
  const [a, m, j] = jour.split('-').map(Number);
  const [h, mn] = heure.split(':').map(Number);
  const f = d => d.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const debut = new Date(Date.UTC(a, m - 1, j, h, mn));
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Visite – ${v.bien.titre}`,
    dates: `${f(debut)}/${f(new Date(debut.getTime() + 45 * 6e4))}`,
    ctz: 'Europe/Paris',
    location: v.lieu || '',
    details: `Visite avec Toam Nguyen (Toan Immo Lyon) – ${TEL}`,
  });
  return 'https://calendar.google.com/calendar/render?' + p;
}

// ───────────── Base (Upstash) ─────────────
const lire = async (r, type, id) => (ID.test(String(id || '')) ? r.get(`${type}:${id}`) : null);
async function tous(r, type, max) {
  const ids = await r.lrange(`${type}s:ids`, 0, max - 1);
  if (!ids.length) return [];
  return (await r.mget(...ids.map(i => `${type}:${i}`))).filter(Boolean);
}
async function creer(r, type, fiche, duree) {
  await r.set(`${type}:${fiche.id}`, fiche, { ex: duree });
  await r.lpush(`${type}s:ids`, fiche.id);
}
const sauver = (r, type, fiche) => r.set(`${type}:${fiche.id}`, fiche, { keepTtl: true });
async function supprimer(r, type, id) {
  await r.del(`${type}:${id}`);
  await r.lrem(`${type}s:ids`, 0, id);
}

// ───────────── Emails ─────────────
const bouton = (href, texte, or = true) =>
  `<a href="${href}" style="display:inline-block;background:${or ? '#C9A84C' : '#1A2E4A'};color:${or ? '#0F1E33' : '#fff'};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;margin:0 8px 8px 0;">${texte}</a>`;

function gabarit(titre, corps, pied = '') {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EEECE8;">
  <div style="background:#1A2E4A;padding:22px 28px;">
    <div style="color:#C9A84C;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Toan Immo Lyon · Est lyonnais</div>
    <div style="color:#fff;font-size:21px;font-family:Georgia,serif;margin-top:6px;">${esc(titre)}</div>
  </div>
  <div style="padding:24px 28px;font-size:15px;line-height:1.7;color:#3D3B38;">
    ${corps}
    <p style="margin:18px 0 0;">Bien à vous,<br/><strong>Toam Nguyen</strong><br/><span style="color:#7A7670;font-size:13px;">Conseiller immobilier · Réseau Propriétés-Privées · ${TEL}</span></p>
  </div>
  <div style="background:#F8F7F5;padding:14px 28px;font-size:11px;color:#B8B4AC;line-height:1.6;">${pied}${MENTIONS}</div>
</div></body></html>`;
}

async function envoyer({ to, sujet, html, desabo, pj }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY manquante');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EXPEDITEUR,
    to,
    reply_to: REPONSE,
    subject: sujet,
    html,
    ...(desabo ? { headers: { 'List-Unsubscribe': `<${desabo}>` } } : {}),
    ...(pj ? { attachments: pj } : {}),
  });
  if (error) throw new Error(error.message || 'Resend');
}
const emailAgent = () => process.env.LEAD_EMAIL || process.env.VALIDATION_EMAIL;
const texteEnHtml = t => String(t).split(/\n{2,}/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br/>')}</p>`).join('');

// ───────────── Visites : emails ─────────────
const lienVisite = (v, vue) => `${SITE}/visite.html?id=${v.id}&jeton=${v.jeton}&vue=${vue}`;

function encartVisite(v) {
  return `<table style="border-collapse:collapse;width:100%;background:#FBF8F0;border-left:3px solid #C9A84C;margin:6px 0 18px;">
    <tr><td style="padding:10px 14px 2px;font-size:13px;color:#7A7670;">Bien</td><td style="padding:10px 14px 2px;"><strong>${esc(v.bien.titre)}</strong>${v.bien.commune ? ' · ' + esc(v.bien.commune) : ''}</td></tr>
    <tr><td style="padding:2px 14px;font-size:13px;color:#7A7670;">Date</td><td style="padding:2px 14px;"><strong>${esc(dateTexte(v.quand))}</strong></td></tr>
    <tr><td style="padding:2px 14px 10px;font-size:13px;color:#7A7670;white-space:nowrap;">Rendez-vous</td><td style="padding:2px 14px 10px;">${esc(v.lieu || 'Je vous communiquerai le lieu précis par téléphone')}</td></tr>
  </table>`;
}
const blocBon = v => (v.bon ? '' : `<p>Pour gagner du temps sur place, vous pouvez dès maintenant <strong>signer votre bon de visite en ligne</strong> (1 minute) :</p><div style="margin:14px 0;">${bouton(lienVisite(v, 'bon'), '✍️ Signer le bon de visite')}</div>`);

async function mailConfirmation(v, modifie = false) {
  await envoyer({
    to: v.visiteur.email,
    sujet: `${modifie ? 'Nouvel horaire de' : 'Confirmation de'} votre visite – ${dateTexte(v.quand)}`,
    html: gabarit(modifie ? 'Votre visite est déplacée' : 'Votre visite est confirmée', `
      <p>Bonjour ${esc(v.visiteur.prenom)},</p>
      <p>${modifie ? 'Notre rendez-vous a été déplacé. Voici le nouvel horaire :' : 'Je vous confirme notre rendez-vous pour la visite suivante :'}</p>
      ${encartVisite(v)}
      ${blocBon(v)}
      <p><a href="${lienAgenda(v)}" style="color:#1A2E4A;">📅 Ajouter à mon agenda Google</a></p>
      <p>En cas d'empêchement ou de retard, merci de me prévenir au <a href="tel:${TEL.replace(/\s/g, '')}" style="color:#1A2E4A;">${TEL}</a>.</p>`),
  });
}
async function mailVendeurVisite(v, b) {
  await envoyer({
    to: b.vendeur.email,
    sujet: `Une visite de votre bien est programmée – ${dateTexte(v.quand)}`,
    html: gabarit('Une visite est programmée', `
      <p>Bonjour ${esc(b.vendeur.prenom)},</p>
      <p>Une visite de votre bien (${esc(b.titre)}) est programmée <strong>${esc(dateTexte(v.quand))}</strong>.</p>
      <p>Je vous ferai un retour après la visite, avec l'avis du visiteur.</p>`),
  });
}
async function mailRappel(v) {
  await envoyer({
    to: v.visiteur.email,
    sujet: `Rappel : votre visite de demain à ${v.quand.slice(11, 16).replace(':', 'h')}`,
    html: gabarit('À demain pour votre visite', `
      <p>Bonjour ${esc(v.visiteur.prenom)},</p>
      <p>Un petit rappel de notre rendez-vous de demain :</p>
      ${encartVisite(v)}
      ${blocBon(v)}
      <p>En cas d'empêchement, merci de me prévenir au <a href="tel:${TEL.replace(/\s/g, '')}" style="color:#1A2E4A;">${TEL}</a>.</p>`),
  });
}
async function mailAnnulation(v) {
  await envoyer({
    to: v.visiteur.email,
    sujet: `Visite annulée – ${dateTexte(v.quand)}`,
    html: gabarit('Votre visite est annulée', `
      <p>Bonjour ${esc(v.visiteur.prenom)},</p>
      <p>La visite prévue <strong>${esc(dateTexte(v.quand))}</strong> (${esc(v.bien.titre)}) est annulée.</p>
      <p>Je reste à votre disposition pour convenir d'une autre date ou vous présenter d'autres biens : il suffit de répondre à cet email ou de m'appeler.</p>`),
  });
}
async function mailDemandeAvis(v) {
  await envoyer({
    to: v.visiteur.email,
    sujet: 'Votre avis sur la visite : 1 minute',
    html: gabarit('Qu\'avez-vous pensé du bien ?', `
      <p>Bonjour ${esc(v.visiteur.prenom)},</p>
      <p>Merci d'avoir visité le bien « ${esc(v.bien.titre)} » ${esc(dateTexte(v.quand).split(' à ')[0])}.</p>
      <p>Votre ressenti m'est précieux, qu'il soit positif ou non : il m'aide à mieux cibler ce que je vous propose et à faire un retour honnête au propriétaire. Cela prend une minute.</p>
      <div style="margin:18px 0;">${bouton(lienVisite(v, 'avis'), '💬 Donner mon avis')}</div>`),
  });
}
async function mailsBonSigne(v) {
  const corps = texteBon(v).map(p => `<p>${esc(p)}</p>`).join('') +
    `<p style="background:#FBF8F0;border-left:3px solid #C9A84C;padding:10px 14px;font-size:13px;">Signé électroniquement par <strong>${esc(v.bon.nom)}</strong> le ${esc(dateTexte(v.bon.signeLe))} (heure de Paris).<br/>Référence : ${esc(v.id)} · Adresse IP : ${esc(v.bon.ip)}</p>`;
  const pj = v.bon.signature ? [{ filename: 'signature.png', content: v.bon.signature.split(',')[1] }] : undefined;
  const envois = [];
  if (emailValide(v.visiteur.email)) {
    envois.push(envoyer({ to: v.visiteur.email, sujet: 'Votre bon de visite signé', pj, html: gabarit('Votre bon de visite', `<p>Bonjour ${esc(v.visiteur.prenom)},</p><p>Voici la copie du bon de visite que vous venez de signer.</p>${corps}`) }));
  }
  if (emailAgent()) {
    envois.push(envoyer({ to: emailAgent(), sujet: `✍️ Bon de visite signé – ${v.visiteur.prenom} ${v.visiteur.nom} – ${v.bien.titre}`, pj, html: gabarit('Bon de visite signé', corps) }));
  }
  (await Promise.allSettled(envois)).forEach(x => { if (x.status === 'rejected') console.error('bon de visite – email :', x.reason?.message); });
}
async function mailAgentAvis(v) {
  if (!emailAgent()) return;
  const a = v.avis;
  const ligne = (k, val) => (val ? `<tr><td style="padding:4px 14px 4px 0;color:#7A7670;font-size:13px;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:4px 0;font-size:14px;">${esc(val)}</td></tr>` : '');
  await envoyer({
    to: emailAgent(),
    sujet: `💬 Avis de visite ${a.note}/5 – ${v.visiteur.prenom} ${v.visiteur.nom} – ${v.bien.titre}`,
    html: gabarit(`Avis de visite : ${a.note}/5`, `
      <p><strong>${esc(v.visiteur.prenom)} ${esc(v.visiteur.nom)}</strong> a donné son avis sur « ${esc(v.bien.titre)} » (visite du ${esc(dateTexte(v.quand))}).</p>
      <table style="border-collapse:collapse;">
        ${ligne('Note', `${a.note}/5`)}${ligne('Points appréciés', a.plus)}${ligne('Réserves', a.moins)}
        ${ligne('Prix jugé', PRIX_PERCU[a.prix])}${ligne('Suite', INTENTIONS[a.intention])}${ligne('Commentaire', a.commentaire)}
      </table>
      <p><a href="${SITE}/suivi.html" style="color:#1A2E4A;">Ouvrir le suivi des visites →</a></p>`),
  });
}

// ───────────── Compte rendu au vendeur ─────────────
function visitesDuCompteRendu(visites, bienId) {
  const maintenant = maintenantParis();
  const passees = visites.filter(v => v.bien.id === bienId && v.statut !== 'annulee' && v.quand < maintenant)
    .sort((a, b) => a.quand.localeCompare(b.quand));
  const nouvelles = passees.filter(v => !v.crLe);
  return nouvelles.length ? nouvelles : passees;
}
function faitsVisite(v, i) {
  const a = v.avis;
  const lignes = [`Visite ${i + 1} – ${dateTexte(v.quand)}`];
  if (a) {
    lignes.push(`Note du visiteur : ${a.note}/5`);
    if (a.plus) lignes.push(`Points appréciés : ${a.plus}`);
    if (a.moins) lignes.push(`Réserves : ${a.moins}`);
    if (a.prix) lignes.push(`Prix jugé : ${PRIX_PERCU[a.prix]}`);
    if (a.intention) lignes.push(`Suite envisagée : le visiteur ${INTENTIONS[a.intention]}`);
    if (a.commentaire) lignes.push(`Commentaire : ${a.commentaire}`);
  } else lignes.push('Le visiteur n\'a pas encore transmis son avis.');
  if (v.notes) lignes.push(`Mon observation : ${v.notes}`);
  return lignes.join('\n');
}
async function brouillonCompteRendu(b, visites) {
  const faits = visites.map(faitsVisite).join('\n\n');
  const simple = `Bonjour ${b.vendeur.prenom},\n\nVoici le compte rendu ${visites.length > 1 ? `des ${visites.length} dernières visites` : 'de la dernière visite'} de votre bien (${b.titre}).\n\n${faits}\n\nJe reste à votre disposition pour en discuter et faire le point sur la suite de la commercialisation.`;
  if (!process.env.ANTHROPIC_API_KEY) return { texte: simple, ia: false };
  try {
    const rep = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `Tu es Toam Nguyen, conseiller immobilier indépendant à Lyon. Rédige le corps d'un email de compte rendu de visites destiné au vendeur d'un bien.

Vendeur : ${b.vendeur.prenom} ${b.vendeur.nom}
Bien : ${b.titre}${b.commune ? ', ' + b.commune : ''}${b.prix ? `, affiché à ${fmt(b.prix)} €` : ''}

Faits recueillis (ne rien inventer, ne rien ajouter qui n'y figure pas) :
${faits}

Consignes : français, vouvoiement, ton professionnel, chaleureux et honnête. Commence par « Bonjour ${b.vendeur.prenom}, ». Résume chaque visite en restant fidèle aux faits, sans jamais nommer les visiteurs, puis dégage en quelques phrases les enseignements (points forts qui ressortent, réserves récurrentes, perception du prix) et propose la suite. Si les avis sont réservés sur le prix, dis-le avec tact. 120 à 250 mots. Texte brut uniquement : pas d'objet, pas de markdown, pas de signature (elle est ajoutée automatiquement).`,
        }],
      }),
    });
    const data = await rep.json();
    const texte = rep.ok && data.content && data.content[0] && data.content[0].text;
    if (!texte) { console.error('compte rendu – IA :', rep.status, data?.error?.message); return { texte: simple, ia: false }; }
    return { texte: texte.trim(), ia: true };
  } catch (e) {
    console.error('compte rendu – IA :', e.message);
    return { texte: simple, ia: false };
  }
}

// ───────────── Fidélisation : contenu des messages ─────────────
const lienDesabo = c => `${SITE}/api/relances?desabo=${c.id}&jeton=${c.jeton}`;

function messageFidelite(c, cle) {
  const p = esc(c.prenom);
  const achat = c.role !== 'vendeur';
  const ville = c.commune ? ` à ${esc(c.commune.split(' (')[0])}` : '';
  const reco = '<p>Et si un proche a un projet de vente ou d\'achat dans l\'Est lyonnais, n\'hésitez pas à lui transmettre mes coordonnées : je l\'accompagnerai avec le même soin.</p>';
  const estimation = `<p>Si vous êtes curieux de connaître la valeur actuelle de votre bien, je vous offre une <strong>estimation actualisée, gratuite et sans engagement</strong> : il suffit de répondre à cet email.</p>`;
  if (cle === 'j30') {
    return achat
      ? { sujet: 'Bien installé(e) dans votre nouveau logement ?', titre: 'Déjà un mois !', corps: `<p>Bonjour ${p},</p><p>Cela fait un mois que vous avez signé pour votre logement${ville}. J'espère que l'installation se passe bien et que vous commencez à vous sentir chez vous.</p><p>Si une question se pose (travaux, artisans, démarches, copropriété), je reste disponible : mon accompagnement ne s'arrête pas à la signature.</p>${reco}` }
      : { sujet: 'Un mois après la vente : tout s\'est bien passé ?', titre: 'Un mois après votre vente', corps: `<p>Bonjour ${p},</p><p>Cela fait un mois que la vente de votre bien${ville} est signée. J'espère que tout s'est bien déroulé depuis et que votre nouveau projet avance comme vous le souhaitez.</p><p>Si une question se pose, ou si vous avez un nouveau projet immobilier, je reste à votre écoute.</p>${reco}` };
  }
  if (cle.startsWith('voeux')) {
    return { sujet: `Très belle année ${cle.slice(5)} !`, titre: `Belle année ${cle.slice(5)}`, corps: `<p>Bonjour ${p},</p><p>Je vous souhaite, ainsi qu'à vos proches, une très belle année ${cle.slice(5)} : qu'elle vous apporte santé, sérénité et de beaux projets.</p><p>Merci encore pour votre confiance. Je reste à votre disposition pour toute question immobilière, même par simple curiosité.</p>${reco}` };
  }
  if (cle.startsWith('an')) {
    const k = Number(cle.slice(2));
    const duree = k === 1 ? 'un an' : `${k} ans`;
    return achat
      ? { sujet: `Déjà ${duree} dans votre logement !`, titre: `${k === 1 ? 'Un an' : k + ' ans'} déjà`, corps: `<p>Bonjour ${p},</p><p>Il y a ${duree}, vous signiez l'achat de votre logement${ville}. Le temps passe vite ! J'espère que vous vous y plaisez toujours autant.</p><p>Le marché a évolué depuis votre achat.</p>${estimation}${reco}` }
      : { sujet: `${k === 1 ? 'Un an' : k + ' ans'} déjà depuis votre vente`, titre: `${k === 1 ? 'Un an' : k + ' ans'} déjà`, corps: `<p>Bonjour ${p},</p><p>Il y a ${duree}, nous signions ensemble la vente de votre bien${ville}. Je garde un très bon souvenir de ce projet, et j'espère que tout va bien pour vous depuis.</p><p>Si un nouveau projet se dessine (achat, investissement, vente d'un autre bien), je serai ravi de vous accompagner à nouveau.</p>${reco}` };
  }
  // « nouvelles » : relance manuelle d'un ancien client
  return { sujet: 'Quelques nouvelles de votre conseiller immobilier', titre: 'Je prends de vos nouvelles', corps: `<p>Bonjour ${p},</p><p>Cela fait un moment que nous ne nous sommes pas parlé, et je voulais simplement prendre de vos nouvelles. J'espère que tout va bien pour vous${achat && ville ? ` et que vous vous plaisez toujours${ville}` : ''}.</p><p>Le marché immobilier de l'Est lyonnais a beaucoup bougé ces derniers temps.</p>${estimation}${reco}<p>Si mon accompagnement vous a satisfait et que vous ne l'avez pas encore fait, <a href="${LIEN_AVIS_GOOGLE}" style="color:#1A2E4A;">un avis Google</a> m'aiderait beaucoup.</p>` };
}
async function envoyerFidelite(c, cle) {
  const { sujet, titre, corps } = messageFidelite(c, cle);
  const desabo = lienDesabo(c);
  await envoyer({
    to: c.email, sujet, desabo,
    html: gabarit(titre, corps, `Vous recevez cet email car vous avez été accompagné(e) par Toan Immo Lyon dans un projet immobilier. <a href="${desabo}" style="color:#7A7670;">Ne plus recevoir ces messages</a>.<br/>`),
  });
}
const clientActif = c => c.accord && !c.desinscrit && emailValide(c.email) && !!c.dateSignature;

// Message automatique à envoyer aujourd'hui à ce client (ou null)
function echeanceFidelite(c, auj) {
  const s = c.dateSignature, e = c.envois || {};
  if (!e.j30 && auj >= decalerJour(s, 30) && auj < decalerJour(s, 60)) return 'j30';
  for (let k = 1; k <= ANNEES_SUIVI; k++) {
    const a = decalerAnnee(s, k);
    if (auj < a) break;
    if (!e['an' + k] && auj < decalerJour(a, 14)) return 'an' + k;
  }
  const annee = auj.slice(0, 4);
  if (!e['voeux' + annee] && auj >= `${annee}-01-02` && auj <= `${annee}-01-15` && s <= decalerJour(auj, -45) && auj < decalerAnnee(s, ANNEES_SUIVI)) return 'voeux' + annee;
  return null;
}
// Prochain message automatique prévu (pour l'affichage dans le suivi)
function prochainMessage(c, auj) {
  if (!clientActif(c)) return null;
  const s = c.dateSignature, e = c.envois || {};
  const fin = decalerAnnee(s, ANNEES_SUIVI);
  const candidats = [];
  const j30 = decalerJour(s, 30);
  if (!e.j30 && auj < decalerJour(s, 60)) candidats.push({ date: j30 < auj ? auj : j30, libelle: 'un mois après la signature' });
  for (let k = 1; k <= ANNEES_SUIVI; k++) {
    const a = decalerAnnee(s, k);
    if (e['an' + k] || decalerJour(a, 14) <= auj) continue;
    candidats.push({ date: a < auj ? auj : a, libelle: `anniversaire (${k} an${k > 1 ? 's' : ''})` });
    break;
  }
  const an = Number(auj.slice(0, 4));
  const voeux = [an, an + 1].map(y => `${y}-01-02`).find(d => d >= auj && !e['voeux' + d.slice(0, 4)]);
  if (voeux && voeux < fin && s <= decalerJour(voeux, -45)) candidats.push({ date: voeux, libelle: 'vœux de nouvelle année' });
  return candidats.sort((x, y) => x.date.localeCompare(y.date))[0] || null;
}

function ficheClient(d, base = {}) {
  return {
    ...base,
    prenom: clip(d.prenom, 80), nom: clip(d.nom, 80),
    email: clip(d.email, 120).toLowerCase(), tel: clip(d.tel, 40),
    role: d.role === 'vendeur' ? 'vendeur' : 'acheteur',
    commune: clip(d.commune, 80), bien: clip(d.bien, 200),
    dateSignature: lireDate(d.dateSignature),
    accord: d.accord !== false,
  };
}
async function creerClient(r, d, origine) {
  const c = ficheClient(d, { id: nouvelId(), date: new Date().toISOString(), jeton: nouveauJeton(), envois: {}, origine });
  await creer(r, 'client', c, DUREE_CLIENT);
  return c;
}
// Appelé quand un lead passe en « Vente conclue » : le client entre dans le programme de fidélisation
export async function clientDepuisLead(r, lead) {
  if (lead.clientId || !emailValide(lead.email)) return null;
  const c = await creerClient(r, {
    prenom: lead.prenom, nom: lead.nom, email: lead.email, tel: lead.tel, commune: lead.commune,
    role: lead.type === 'recherche' ? 'acheteur' : 'vendeur',
    dateSignature: maintenantParis().slice(0, 10),
  }, 'lead');
  return c.id;
}

// ───────────── Tâches quotidiennes (appelées par le cron de /api/relances) ─────────────
export async function tachesQuotidiennes(r) {
  const bilan = { rappels: 0, demandesAvis: 0, fidelite: 0, erreurs: 0 };
  const maintenant = maintenantParis();
  const auj = maintenant.slice(0, 10), demain = decalerJour(auj, 1), ilYA7Jours = decalerJour(auj, -7);

  for (const v of await tous(r, 'visite', 300)) {
    if (v.statut === 'annulee' || !emailValide(v.visiteur.email)) continue;
    try {
      const jour = v.quand.slice(0, 10);
      if (v.statut === 'planifiee' && !v.rappelLe && jour === demain) {
        await mailRappel(v);
        v.rappelLe = new Date().toISOString();
        await sauver(r, 'visite', v);
        bilan.rappels++;
      } else if (v.quand < maintenant && jour >= ilYA7Jours && !v.avisDemandeLe && !v.avis) {
        await mailDemandeAvis(v);
        v.avisDemandeLe = new Date().toISOString();
        if (v.statut === 'planifiee') v.statut = 'effectuee';
        await sauver(r, 'visite', v);
        bilan.demandesAvis++;
      }
    } catch (e) { console.error('visite', v.id, e.message); bilan.erreurs++; }
  }

  for (const c of await tous(r, 'client', 1000)) {
    if (!clientActif(c)) continue;
    const cle = echeanceFidelite(c, auj);
    if (!cle) continue;
    try {
      await envoyerFidelite(c, cle);
      c.envois = { ...(c.envois || {}), [cle]: auj };
      await sauver(r, 'client', c);
      await compter('fidelite_envoyee');
      bilan.fidelite++;
    } catch (e) { console.error('fidélité', c.id, e.message); bilan.erreurs++; }
  }
  return bilan;
}

// ───────────── Routes publiques (via /api/relances?visite=… ou ?desabo=…) ─────────────
function pageMessage(titre, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>${titre}</title></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F8F7F5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;">
<div style="background:#fff;border-radius:12px;padding:40px 32px;max-width:440px;text-align:center;border:1px solid #EEECE8;">
<h1 style="font-family:Georgia,serif;color:#1A2E4A;font-size:22px;margin:0 0 12px;">${titre}</h1><p style="color:#7A7670;font-size:15px;line-height:1.6;margin:0 0 20px;">${message}</p>
<a href="${SITE}" style="color:#1A2E4A;font-size:14px;">Retour au site Toan Immo Lyon</a></div></body></html>`;
}

export async function suiviPublic(req, res, r) {
  const jeton = String(req.query.jeton || '');

  if (req.query.desabo) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const c = await lire(r, 'client', req.query.desabo);
    if (!c || c.jeton !== jeton) return res.status(404).send(pageMessage('Lien invalide', 'Ce lien de désinscription n\'est pas valide ou a expiré.'));
    if (!c.desinscrit) { c.desinscrit = new Date().toISOString(); await sauver(r, 'client', c); await compter('fidelite_desinscription'); }
    return res.status(200).send(pageMessage('C\'est noté', 'Vous ne recevrez plus de messages de ma part. Merci pour votre confiance, et à bientôt peut-être.'));
  }

  const v = await lire(r, 'visite', req.query.visite);
  if (!v || v.jeton !== jeton) return res.status(404).json({ error: 'Ce lien n\'est pas valide ou a expiré.' });

  if (req.method === 'GET') {
    return res.status(200).json({
      prenom: v.visiteur.prenom, nom: v.visiteur.nom,
      bien: v.bien.titre, commune: v.bien.commune,
      quand: dateTexte(v.quand), lieu: v.lieu, annulee: v.statut === 'annulee',
      texteBon: texteBon(v),
      bon: v.bon ? { nom: v.bon.nom, signeLe: dateTexte(v.bon.signeLe) } : null,
      avisDonne: !!v.avis,
    });
  }
  if (req.method !== 'POST') return res.status(405).end();
  if (await limiteAtteinte(req, 'visite', 20)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' });
  if (v.statut === 'annulee') return res.status(409).json({ error: 'Cette visite a été annulée.' });
  const d = parseBody(req);

  if (d.action === 'signer') {
    if (v.bon) return res.status(409).json({ error: 'Ce bon de visite est déjà signé.' });
    const nom = clip(d.nom, 120);
    const signature = typeof d.signature === 'string' && d.signature.startsWith('data:image/png;base64,') && d.signature.length < 120000 ? d.signature : '';
    if (nom.length < 3 || d.accepte !== true) return res.status(400).json({ error: 'Indiquez votre nom complet et cochez la case d\'acceptation.' });
    v.bon = {
      nom, signature,
      signeLe: maintenantParis(),
      ip: String(req.headers['x-forwarded-for'] || 'inconnue').split(',')[0].trim(),
      navigateur: clip(req.headers['user-agent'], 200),
      texte: texteBon(v),
    };
    await sauver(r, 'visite', v);
    await compter('bon_signe');
    await mailsBonSigne(v);
    return res.status(200).json({ ok: true, signeLe: dateTexte(v.bon.signeLe) });
  }

  if (d.action === 'avis') {
    if (v.avis) return res.status(409).json({ error: 'Votre avis a déjà été enregistré. Merci !' });
    const note = Number(d.note);
    if (!Number.isInteger(note) || note < 1 || note > 5) return res.status(400).json({ error: 'Choisissez une note de 1 à 5.' });
    v.avis = {
      note, date: new Date().toISOString(),
      plus: clip(d.plus, 600), moins: clip(d.moins, 600), commentaire: clip(d.commentaire, 800),
      prix: PRIX_PERCU[d.prix] ? d.prix : '', intention: INTENTIONS[d.intention] ? d.intention : '',
    };
    if (v.statut === 'planifiee') v.statut = 'effectuee';
    await sauver(r, 'visite', v);
    await compter('avis_visite');
    await mailAgentAvis(v).catch(e => console.error('avis de visite – email :', e.message));
    return res.status(200).json({ ok: true });
  }
  res.status(400).json({ error: 'Action inconnue' });
}

// ───────────── Route admin (via /api/leads?module=suivi) ─────────────
export async function suiviAdmin(req, res, r) {
  const refus = (code, error) => res.status(code).json({ error });

  if (req.method === 'GET') {
    const [biens, visites, clients, stats] = await Promise.all([
      tous(r, 'bien', 300), tous(r, 'visite', 300), tous(r, 'client', 1000), r.hgetall(`stats:${moisCle()}`),
    ]);
    const auj = maintenantParis().slice(0, 10);
    return res.status(200).json({
      biens,
      // La signature dessinée et le texte figé restent en base : inutile de les renvoyer à chaque chargement
      visites: visites.map(v => (v.bon ? { ...v, bon: { nom: v.bon.nom, signeLe: v.bon.signeLe } } : v)),
      clients: clients.map(c => ({ ...c, prochain: prochainMessage(c, auj) })),
      stats: stats || {}, maintenant: maintenantParis(),
    });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const d = parseBody(req);

  switch (d.action) {
    case 'bien': {
      const champs = {
        titre: clip(d.titre, 120), adresse: clip(d.adresse, 200), commune: clip(d.commune, 80),
        prix: Math.max(0, Math.round(Number(d.prix) || 0)), mandat: clip(d.mandat, 40),
        vendeur: { prenom: clip(d.vendeurPrenom, 80), nom: clip(d.vendeurNom, 80), email: clip(d.vendeurEmail, 120).toLowerCase() },
      };
      if (!champs.titre) return refus(400, 'Donnez un titre au bien (ex. « T3 avec balcon »).');
      if (champs.vendeur.email && !emailValide(champs.vendeur.email)) return refus(400, 'L\'email du vendeur n\'est pas valide.');
      if (d.id) {
        const b = await lire(r, 'bien', d.id);
        if (!b) return refus(404, 'Bien introuvable');
        await sauver(r, 'bien', { ...b, ...champs });
      } else {
        await creer(r, 'bien', { id: nouvelId(), date: new Date().toISOString(), archive: false, crs: [], ...champs }, TROIS_ANS);
      }
      return res.status(200).json({ ok: true });
    }
    case 'bien_archiver': {
      const b = await lire(r, 'bien', d.id);
      if (!b) return refus(404, 'Bien introuvable');
      b.archive = !b.archive;
      await sauver(r, 'bien', b);
      return res.status(200).json({ ok: true });
    }
    case 'visite': {
      const b = await lire(r, 'bien', d.bienId);
      if (!b) return refus(400, 'Choisissez le bien visité.');
      const quand = String(d.quand || '').slice(0, 16);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quand) || !lireDate(quand.slice(0, 10))) return refus(400, 'Indiquez la date et l\'heure de la visite.');
      const visiteur = { prenom: clip(d.prenom, 80), nom: clip(d.nom, 80), tel: clip(d.tel, 40), email: clip(d.email, 120).toLowerCase() };
      if (!visiteur.prenom || !visiteur.nom) return refus(400, 'Indiquez le prénom et le nom du visiteur.');
      if (visiteur.email && !emailValide(visiteur.email)) return refus(400, 'L\'email du visiteur n\'est pas valide.');
      const v = {
        id: nouvelId(), jeton: nouveauJeton(), date: new Date().toISOString(), statut: 'planifiee',
        bien: { id: b.id, titre: b.titre, adresse: b.adresse, commune: b.commune, prix: b.prix, mandat: b.mandat },
        visiteur, quand, lieu: clip(d.lieu, 200) || [b.adresse, b.commune].filter(Boolean).join(', '), notes: '',
      };
      const emails = { visiteur: 'pas d\'email', vendeur: null };
      if (visiteur.email) {
        try { await mailConfirmation(v); v.confirmeLe = new Date().toISOString(); emails.visiteur = 'envoyé'; await compter('visite_confirmee'); }
        catch (e) { console.error('confirmation de visite :', e.message); emails.visiteur = 'erreur'; }
      }
      if (d.informerVendeur && emailValide(b.vendeur.email)) {
        try { await mailVendeurVisite(v, b); emails.vendeur = 'envoyé'; }
        catch (e) { console.error('information du vendeur :', e.message); emails.vendeur = 'erreur'; }
      }
      await creer(r, 'visite', v, TROIS_ANS);
      return res.status(200).json({ ok: true, emails });
    }
    case 'visite_maj': {
      const v = await lire(r, 'visite', d.id);
      if (!v) return refus(404, 'Visite introuvable');
      let email = null;
      if (typeof d.notes === 'string') v.notes = clip(d.notes, 1000);
      if (d.quand && d.quand !== v.quand) {
        const quand = String(d.quand).slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quand) || !lireDate(quand.slice(0, 10))) return refus(400, 'Date invalide.');
        if (v.bon) return refus(409, 'Le bon de visite est déjà signé pour cette date : créez plutôt une nouvelle visite.');
        v.quand = quand; v.statut = 'planifiee'; delete v.rappelLe; delete v.avisDemandeLe;
        if (emailValide(v.visiteur.email)) {
          try { await mailConfirmation(v, true); email = 'envoyé'; } catch (e) { console.error('report de visite :', e.message); email = 'erreur'; }
        }
      }
      if (d.statut && d.statut !== v.statut) {
        if (!['planifiee', 'effectuee', 'annulee'].includes(d.statut)) return refus(400, 'Statut invalide');
        v.statut = d.statut;
        if (d.statut === 'annulee' && d.prevenir && emailValide(v.visiteur.email)) {
          try { await mailAnnulation(v); email = 'envoyé'; } catch (e) { console.error('annulation de visite :', e.message); email = 'erreur'; }
        }
      }
      await sauver(r, 'visite', v);
      return res.status(200).json({ ok: true, email });
    }
    case 'visite_avis_demander': {
      const v = await lire(r, 'visite', d.id);
      if (!v) return refus(404, 'Visite introuvable');
      if (!emailValide(v.visiteur.email)) return refus(400, 'Ce visiteur n\'a pas d\'email : envoyez-lui le lien par SMS.');
      await mailDemandeAvis(v);
      v.avisDemandeLe = new Date().toISOString();
      if (v.statut === 'planifiee') v.statut = 'effectuee';
      await sauver(r, 'visite', v);
      return res.status(200).json({ ok: true });
    }
    case 'visite_suppr': {
      if (!ID.test(String(d.id))) return refus(400, 'Identifiant invalide');
      await supprimer(r, 'visite', d.id);
      return res.status(200).json({ ok: true });
    }
    case 'cr_brouillon': {
      const b = await lire(r, 'bien', d.bienId);
      if (!b) return refus(404, 'Bien introuvable');
      const visites = visitesDuCompteRendu(await tous(r, 'visite', 300), b.id);
      if (!visites.length) return refus(400, 'Aucune visite passée pour ce bien : rien à raconter pour l\'instant.');
      const { texte, ia } = await brouillonCompteRendu(b, visites);
      return res.status(200).json({ texte, ia, visiteIds: visites.map(v => v.id), sansAvis: visites.filter(v => !v.avis).length });
    }
    case 'cr_envoyer': {
      const b = await lire(r, 'bien', d.bienId);
      if (!b) return refus(404, 'Bien introuvable');
      const texte = clip(d.texte, 6000);
      if (texte.length < 40) return refus(400, 'Le compte rendu est vide.');
      if (!emailValide(b.vendeur.email)) return refus(400, 'Ce bien n\'a pas d\'email vendeur : complétez la fiche du bien.');
      await envoyer({ to: b.vendeur.email, sujet: `Compte rendu des visites de votre bien – ${b.titre}`, html: gabarit('Compte rendu de visites', texteEnHtml(texte)) });
      const date = new Date().toISOString();
      b.crs = [{ date, texte }, ...(b.crs || [])].slice(0, 10);
      await sauver(r, 'bien', b);
      for (const id of (Array.isArray(d.visiteIds) ? d.visiteIds : []).slice(0, 50)) {
        const v = await lire(r, 'visite', id);
        if (v && v.bien.id === b.id) { v.crLe = date; await sauver(r, 'visite', v); }
      }
      await compter('cr_envoye');
      return res.status(200).json({ ok: true });
    }
    case 'client': {
      if (!clip(d.prenom, 80) && !clip(d.nom, 80)) return refus(400, 'Indiquez au moins le prénom ou le nom du client.');
      if (!emailValide(clip(d.email, 120))) return refus(400, 'Un email valide est nécessaire pour les messages automatiques.');
      if (!lireDate(d.dateSignature)) return refus(400, 'Indiquez la date de signature (elle sert à calculer les anniversaires).');
      if (d.id) {
        const c = await lire(r, 'client', d.id);
        if (!c) return refus(404, 'Client introuvable');
        await sauver(r, 'client', ficheClient(d, c));
      } else await creerClient(r, d, 'saisie');
      return res.status(200).json({ ok: true });
    }
    case 'clients_import': {
      const existants = new Set((await tous(r, 'client', 1000)).map(c => c.email));
      const bilan = { ajoutes: 0, doublons: 0, ignores: [] };
      const lignes = String(d.lignes || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 300);
      for (const [i, ligne] of lignes.entries()) {
        const [prenom, nom, email, tel, role, commune, dateSignature] = ligne.split(/\s*[;\t]\s*/);
        const mail = clip(email, 120).toLowerCase();
        if (!emailValide(mail) || !lireDate(dateSignature)) {
          // La première ligne peut être une ligne de titres (« Prénom ; Nom ; Email… ») : on la saute sans la signaler
          if (i > 0 || emailValide(mail)) bilan.ignores.push(ligne.slice(0, 60));
          continue;
        }
        if (existants.has(mail)) { bilan.doublons++; continue; }
        await creerClient(r, { prenom, nom, email: mail, tel, commune, dateSignature, role: /vend/i.test(role || '') ? 'vendeur' : 'acheteur' }, 'import');
        existants.add(mail);
        bilan.ajoutes++;
      }
      return res.status(200).json({ ok: true, ...bilan });
    }
    case 'client_relancer': {
      const c = await lire(r, 'client', d.id);
      if (!c) return refus(404, 'Client introuvable');
      if (!clientActif(c)) return refus(400, 'Ce client ne peut pas recevoir de message (désinscrit, sans accord ou sans email).');
      await envoyerFidelite(c, 'nouvelles');
      c.envois = { ...(c.envois || {}), ['nouvelles' + maintenantParis().slice(0, 10)]: maintenantParis().slice(0, 10) };
      await sauver(r, 'client', c);
      await compter('fidelite_envoyee');
      return res.status(200).json({ ok: true });
    }
    case 'client_suppr': {
      if (!ID.test(String(d.id))) return refus(400, 'Identifiant invalide');
      await supprimer(r, 'client', d.id);
      return res.status(200).json({ ok: true });
    }
    default:
      return refus(400, 'Action inconnue');
  }
}

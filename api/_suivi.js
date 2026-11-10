// Suivi des visites (confirmations, bons de visite électroniques, avis des visiteurs, comptes rendus
// aux vendeurs) et fidélisation des anciens clients.
// Principe : le site n'envoie d'emails qu'au conseiller. Tous les messages destinés aux visiteurs, vendeurs
// et clients sont préparés sous forme de textes qu'il copie et envoie lui-même depuis sa messagerie.
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
const TROIS_ANS = 3 * 365 * 24 * 3600;
// Nombre d'anniversaires de signature fêtés avant l'arrêt automatique des messages
export const ANNEES_SUIVI = 3;
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

// ───────────── Visites : textes des messages ─────────────
// Le site n'écrit ni aux visiteurs ni aux vendeurs : il prépare les textes, que le conseiller copie
// (ou ouvre dans sa messagerie) pour les envoyer lui-même depuis son adresse professionnelle.
// Les seuls emails envoyés par le site sont destinés au conseiller (bon signé, avis reçu, récapitulatif du matin).
const lienVisite = (v, vue) => `${SITE}/visite.html?id=${v.id}&jeton=${v.jeton}&vue=${vue}`;
const SIGNATURE = `Bien à vous,\nToam Nguyen\n${TEL}`;
// Champ de la visite qui note qu'un message a été envoyé par le conseiller
const CHAMPS_ENVOI = { confirmation: 'confirmeLe', rappel: 'rappelLe', avis: 'avisDemandeLe', annulation: 'annulationLe', vendeur: 'vendeurLe' };

function resumeVisite(v) {
  return `Bien : ${v.bien.titre}${v.bien.commune ? ' · ' + v.bien.commune : ''}\nDate : ${dateTexte(v.quand)}\nRendez-vous : ${v.lieu || 'je vous communiquerai le lieu précis par téléphone'}`;
}
const ligneBon = v => (v.bon ? null : `Pour gagner du temps sur place, vous pouvez dès maintenant signer votre bon de visite en ligne (1 minute) :\n${lienVisite(v, 'bon')}`);

// Messages à envoyer pour cette visite, selon où elle en est. b = fiche du bien (pour l'email du vendeur), facultative.
function messagesVisite(v, b, maintenant) {
  const a = emailValide(v.visiteur.email) ? v.visiteur.email : '';
  const auj = maintenant.slice(0, 10), jour = v.quand.slice(0, 10), futur = v.quand >= maintenant;
  const texte = (...paragraphes) => [`Bonjour ${v.visiteur.prenom},`, ...paragraphes.filter(Boolean), SIGNATURE].join('\n\n');
  const empechement = `En cas d'empêchement ou de retard, merci de me prévenir au ${TEL}.`;
  const liste = [];

  if (v.statut === 'annulee') {
    if (futur && v.confirmeLe && !v.annulationLe) {
      liste.push({ cle: 'annulation', libelle: 'annulation de la visite', a, sujet: `Visite annulée – ${dateTexte(v.quand)}`,
        texte: texte(`La visite prévue ${dateTexte(v.quand)} (${v.bien.titre}) est annulée.`, 'Je reste à votre disposition pour convenir d\'une autre date ou vous présenter d\'autres biens : il suffit de me répondre ou de m\'appeler.') });
    }
    return liste;
  }
  if (futur && !v.confirmeLe) {
    liste.push({ cle: 'confirmation', libelle: v.reporte ? 'nouvel horaire de la visite' : 'confirmation du rendez-vous', a,
      sujet: `${v.reporte ? 'Nouvel horaire de' : 'Confirmation de'} votre visite – ${dateTexte(v.quand)}`,
      texte: texte(v.reporte ? 'Notre rendez-vous a été déplacé. Voici le nouvel horaire :' : 'Je vous confirme notre rendez-vous pour la visite suivante :', resumeVisite(v), ligneBon(v), empechement) });
  }
  // Rappel : la veille ou le jour même, sauf si la confirmation vient juste de partir
  if (futur && v.confirmeLe && !v.rappelLe && jour <= decalerJour(auj, 1) && String(v.confirmeLe).slice(0, 10) < auj) {
    const quand = jour === auj ? 'd\'aujourd\'hui' : 'de demain';
    liste.push({ cle: 'rappel', libelle: `rappel de la visite ${quand}`, a, sujet: `Rappel : votre visite ${quand} à ${v.quand.slice(11, 16).replace(':', 'h')}`,
      texte: texte(`Un petit rappel de notre rendez-vous ${quand} :`, resumeVisite(v), ligneBon(v), empechement) });
  }
  if (!futur && !v.avis && !v.avisDemandeLe && jour >= decalerJour(auj, -7)) {
    liste.push({ cle: 'avis', libelle: 'demande d\'avis après la visite', a, sujet: 'Votre avis sur la visite : 1 minute',
      texte: texte(`Merci d'avoir visité le bien « ${v.bien.titre} » ${dateTexte(v.quand).split(' à ')[0]}.`,
        `Votre ressenti m'est précieux, qu'il soit positif ou non : il m'aide à mieux cibler ce que je vous propose et à faire un retour honnête au propriétaire. Cela prend une minute :\n${lienVisite(v, 'avis')}`) });
  }
  if (futur && v.prevenirVendeur && !v.vendeurLe && b && emailValide(b.vendeur.email)) {
    liste.push({ cle: 'vendeur', libelle: 'information du vendeur', a: b.vendeur.email, sujet: `Une visite de votre bien est programmée – ${dateTexte(v.quand)}`,
      texte: [`Bonjour ${b.vendeur.prenom},`, `Une visite de votre bien (${b.titre}) est programmée ${dateTexte(v.quand)}.`, 'Je vous ferai un retour après la visite, avec l\'avis du visiteur.', SIGNATURE].join('\n\n') });
  }
  return liste;
}

// Emails au conseiller
async function mailAgentBonSigne(v) {
  if (!emailAgent()) return;
  const corps = texteBon(v).map(p => `<p>${esc(p)}</p>`).join('') +
    `<p style="background:#FBF8F0;border-left:3px solid #C9A84C;padding:10px 14px;font-size:13px;">Signé électroniquement par <strong>${esc(v.bon.nom)}</strong> le ${esc(dateTexte(v.bon.signeLe))} (heure de Paris).<br/>Référence : ${esc(v.id)} · Adresse IP : ${esc(v.bon.ip)}</p>
    <p style="font-size:13px;color:#7A7670;">Pour en remettre une copie au visiteur, transférez-lui simplement cet email depuis votre messagerie.</p>`;
  const pj = v.bon.signature ? [{ filename: 'signature.png', content: v.bon.signature.split(',')[1] }] : undefined;
  await envoyer({ to: emailAgent(), sujet: `✍️ Bon de visite signé – ${v.visiteur.prenom} ${v.visiteur.nom} – ${v.bien.titre}`, pj, html: gabarit('Bon de visite signé', corps) });
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

// ───────────── Fidélisation : textes des messages ─────────────
// Ces messages ne sont PAS envoyés par le site : ils sont proposés dans la page de suivi, où le conseiller
// les copie (ou les ouvre dans sa messagerie) pour les envoyer lui-même depuis son adresse professionnelle.
function libelleEcheance(cle) {
  if (cle === 'j30') return 'un mois après la signature';
  if (cle.startsWith('voeux')) return `vœux ${cle.slice(5)}`;
  if (cle.startsWith('an')) return `anniversaire de signature (${cle.slice(2)} an${Number(cle.slice(2)) > 1 ? 's' : ''})`;
  return 'prise de nouvelles';
}
function messageFidelite(c, cle) {
  const achat = c.role !== 'vendeur';
  const ville = c.commune ? ` à ${c.commune.split(' (')[0]}` : '';
  const reco = 'Et si un proche a un projet de vente ou d\'achat dans l\'Est lyonnais, n\'hésitez pas à lui transmettre mes coordonnées : je l\'accompagnerai avec le même soin.';
  const estimation = 'Si vous êtes curieux de connaître la valeur actuelle de votre bien, je vous offre une estimation actualisée, gratuite et sans engagement : il suffit de répondre à ce message.';
  let sujet, corps;
  if (cle === 'j30') {
    if (achat) {
      sujet = 'Bien installé(e) dans votre nouveau logement ?';
      corps = [`Cela fait un mois que vous avez signé pour votre logement${ville}. J'espère que l'installation se passe bien et que vous commencez à vous sentir chez vous.`,
        'Si une question se pose (travaux, artisans, démarches, copropriété), je reste disponible : mon accompagnement ne s\'arrête pas à la signature.', reco];
    } else {
      sujet = 'Un mois après la vente : tout s\'est bien passé ?';
      corps = [`Cela fait un mois que la vente de votre bien${ville} est signée. J'espère que tout s'est bien déroulé depuis et que votre nouveau projet avance comme vous le souhaitez.`,
        'Si une question se pose, ou si vous avez un nouveau projet immobilier, je reste à votre écoute.', reco];
    }
  } else if (cle.startsWith('voeux')) {
    const annee = cle.slice(5);
    sujet = `Très belle année ${annee} !`;
    corps = [`Je vous souhaite, ainsi qu'à vos proches, une très belle année ${annee} : qu'elle vous apporte santé, sérénité et de beaux projets.`,
      'Merci encore pour votre confiance. Je reste à votre disposition pour toute question immobilière, même par simple curiosité.', reco];
  } else if (cle.startsWith('an')) {
    const k = Number(cle.slice(2));
    const duree = k === 1 ? 'un an' : `${k} ans`;
    if (achat) {
      sujet = `Déjà ${duree} dans votre logement !`;
      corps = [`Il y a ${duree}, vous signiez l'achat de votre logement${ville}. Le temps passe vite ! J'espère que vous vous y plaisez toujours autant.`,
        'Le marché a évolué depuis votre achat. ' + estimation, reco];
    } else {
      sujet = `${k === 1 ? 'Un an' : k + ' ans'} déjà depuis votre vente`;
      corps = [`Il y a ${duree}, nous signions ensemble la vente de votre bien${ville}. Je garde un très bon souvenir de ce projet, et j'espère que tout va bien pour vous depuis.`,
        'Si un nouveau projet se dessine (achat, investissement, vente d\'un autre bien), je serai ravi de vous accompagner à nouveau.', reco];
    }
  } else {
    // « nouvelles » : reprise de contact à l'initiative du conseiller
    sujet = 'Quelques nouvelles de votre conseiller immobilier';
    corps = [`Cela fait un moment que nous ne nous sommes pas parlé, et je voulais simplement prendre de vos nouvelles. J'espère que tout va bien pour vous${achat && ville ? ` et que vous vous plaisez toujours${ville}` : ''}.`,
      'Le marché immobilier de l\'Est lyonnais a beaucoup bougé ces derniers temps. ' + estimation, reco,
      `Si mon accompagnement vous a satisfait et que vous ne l'avez pas encore fait, un avis Google m'aiderait beaucoup : ${LIEN_AVIS_GOOGLE}`];
  }
  const texte = [`Bonjour ${c.prenom || ''}`.trim() + ',', ...corps, `Bien à vous,\nToam Nguyen\n${TEL}`,
    'PS : si vous préférez ne plus recevoir ces petits messages, dites-le-moi simplement en réponse.'].join('\n\n');
  return { sujet, texte };
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
// Le site n'écrit qu'au conseiller : chaque matin, un seul email récapitule les nouveaux messages qu'il a
// à envoyer lui-même (rappels de visite, demandes d'avis, fidélisation). Chaque message n'est signalé qu'une fois.
export async function tachesQuotidiennes(r) {
  const bilan = { rappels: 0, demandesAvis: 0, fidelite: 0, erreurs: 0 };
  const maintenant = maintenantParis(), auj = maintenant.slice(0, 10);
  const aSignaler = [];

  for (const v of await tous(r, 'visite', 300)) {
    for (const m of messagesVisite(v, null, maintenant)) {
      if (!['rappel', 'avis'].includes(m.cle) || (v.signales || {})[m.cle]) continue;
      aSignaler.push({
        type: m.cle === 'rappel' ? 'rappels' : 'demandesAvis',
        ligne: `<strong>${esc(`${v.visiteur.prenom} ${v.visiteur.nom}`.trim())}</strong> – ${esc(m.libelle)} (${esc(v.bien.titre)})`,
        noter: () => { v.signales = { ...(v.signales || {}), [m.cle]: auj }; return sauver(r, 'visite', v); },
      });
    }
  }
  for (const c of await tous(r, 'client', 1000)) {
    if (!clientActif(c)) continue;
    const cle = echeanceFidelite(c, auj);
    if (!cle || (c.rappels || {})[cle]) continue;
    aSignaler.push({
      type: 'fidelite',
      ligne: `<strong>${esc(`${c.prenom} ${c.nom}`.trim())}</strong> – ${esc(libelleEcheance(cle))}`,
      noter: () => { c.rappels = { ...(c.rappels || {}), [cle]: auj }; return sauver(r, 'client', c); },
    });
  }

  if (!aSignaler.length) return bilan;
  try {
    if (!emailAgent()) throw new Error('adresse du conseiller non configurée (LEAD_EMAIL)');
    await envoyer({
      to: emailAgent(),
      sujet: `✉️ ${aSignaler.length} message${aSignaler.length > 1 ? 's' : ''} à envoyer aujourd'hui`,
      html: gabarit('Vos messages à envoyer', `
        <p>C'est le bon moment pour écrire à :</p>
        <ul style="margin:0 0 16px 20px;padding:0;">${aSignaler.map(x => `<li>${x.ligne}</li>`).join('')}</ul>
        <p>Les textes sont prêts dans la page de suivi : il reste à les copier dans votre messagerie, puis à les marquer comme envoyés.</p>
        <div style="margin:14px 0;">${bouton(SITE + '/suivi.html', 'Ouvrir les messages à envoyer')}</div>`),
    });
    for (const x of aSignaler) { await x.noter(); bilan[x.type]++; }
  } catch (e) { console.error('récapitulatif du matin :', e.message); bilan.erreurs++; }
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
    await mailAgentBonSigne(v).catch(e => console.error('bon de visite – email :', e.message));
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
      visites: visites.map(v => ({
        ...v,
        ...(v.bon ? { bon: { nom: v.bon.nom, signeLe: v.bon.signeLe } } : {}),
        // Textes prêts à copier (confirmation, rappel, demande d'avis…) selon l'avancement de la visite
        messages: messagesVisite(v, biens.find(b => b.id === v.bien.id), maintenantParis()),
      })),
      clients: clients.map(c => {
        const actif = clientActif(c);
        const cle = actif ? echeanceFidelite(c, auj) : null;
        return {
          ...c,
          prochain: prochainMessage(c, auj),
          // Textes prêts à copier : le message arrivé à échéance (s'il y en a un) et la prise de nouvelles
          aEnvoyer: cle ? { cle, libelle: libelleEcheance(cle), ...messageFidelite(c, cle) } : null,
          nouvelles: actif ? messageFidelite(c, 'nouvelles') : null,
        };
      }),
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
      // Aucun email ne part : les messages (confirmation, information du vendeur) sont proposés dans la page de suivi
      await creer(r, 'visite', {
        id: nouvelId(), jeton: nouveauJeton(), date: new Date().toISOString(), statut: 'planifiee',
        bien: { id: b.id, titre: b.titre, adresse: b.adresse, commune: b.commune, prix: b.prix, mandat: b.mandat },
        visiteur, quand, lieu: clip(d.lieu, 200) || [b.adresse, b.commune].filter(Boolean).join(', '), notes: '',
        prevenirVendeur: !!d.informerVendeur,
      }, TROIS_ANS);
      return res.status(200).json({ ok: true });
    }
    case 'visite_maj': {
      const v = await lire(r, 'visite', d.id);
      if (!v) return refus(404, 'Visite introuvable');
      if (typeof d.notes === 'string') v.notes = clip(d.notes, 1000);
      if (d.quand && d.quand !== v.quand) {
        const quand = String(d.quand).slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quand) || !lireDate(quand.slice(0, 10))) return refus(400, 'Date invalide.');
        if (v.bon) return refus(409, 'Le bon de visite est déjà signé pour cette date : créez plutôt une nouvelle visite.');
        // Nouvel horaire : les messages (confirmation, vendeur, rappel) sont de nouveau à envoyer
        v.reporte = !!v.confirmeLe || !!v.reporte;
        v.quand = quand; v.statut = 'planifiee';
        for (const champ of ['confirmeLe', 'rappelLe', 'avisDemandeLe', 'vendeurLe', 'signales']) delete v[champ];
      }
      if (d.statut && d.statut !== v.statut) {
        if (!['planifiee', 'effectuee', 'annulee'].includes(d.statut)) return refus(400, 'Statut invalide');
        v.statut = d.statut;
      }
      await sauver(r, 'visite', v);
      return res.status(200).json({ ok: true });
    }
    // Le conseiller a envoyé lui-même le message depuis sa messagerie : on le note pour ne plus le proposer
    case 'visite_envoye': {
      const v = await lire(r, 'visite', d.id);
      if (!v) return refus(404, 'Visite introuvable');
      const champ = CHAMPS_ENVOI[d.cle];
      if (!champ) return refus(400, 'Message inconnu');
      if (!v[champ] && d.cle === 'confirmation') await compter('visite_confirmee');
      v[champ] = maintenantParis();
      if (d.cle === 'avis' && v.statut === 'planifiee') v.statut = 'effectuee';
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
      return res.status(200).json({
        texte: `${texte}\n\n${SIGNATURE}`, ia,
        sujet: `Compte rendu des visites de votre bien – ${b.titre}`,
        visiteIds: visites.map(v => v.id), sansAvis: visites.filter(v => !v.avis).length,
      });
    }
    case 'cr_envoye': {
      const b = await lire(r, 'bien', d.bienId);
      if (!b) return refus(404, 'Bien introuvable');
      const texte = clip(d.texte, 6000);
      if (texte.length < 40) return refus(400, 'Le compte rendu est vide.');
      // Le compte rendu a été envoyé par le conseiller depuis sa messagerie : on en garde la trace
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
      const lignes = String(d.lignes || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 300);
      for (const [i, ligne] of lignes.entries()) {
        // Un séparateur = une colonne, même vide (collage depuis Excel : une case vide ne doit pas décaler les suivantes)
        const [prenom, nom, email, tel, role, commune, dateSignature] = ligne.split(/[;\t]/).map(c => c.trim());
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
    // Le conseiller a envoyé lui-même le message depuis sa messagerie : on le note pour ne plus le proposer
    case 'client_envoye': {
      const c = await lire(r, 'client', d.id);
      if (!c) return refus(404, 'Client introuvable');
      if (!clientActif(c)) return refus(400, 'Ce client ne reçoit pas de messages (désinscrit, sans accord ou sans email).');
      const auj = maintenantParis().slice(0, 10);
      const cle = d.cle === 'nouvelles' ? 'nouvelles' + auj : echeanceFidelite(c, auj);
      if (!cle || (d.cle !== 'nouvelles' && cle !== d.cle)) return refus(400, 'Ce message n\'est plus à envoyer.');
      c.envois = { ...(c.envois || {}), [cle]: auj };
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

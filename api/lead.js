import { parseBody, clip, limiteAtteinte } from './_util.js';
import { traiterLead } from './_leads.js';

// Formulaires simples du site : contact, dépôt de bien à vendre, demande de recherche
const SUJETS = {
  contact: 'Nouveau message de contact',
  vendre: 'Nouveau bien à vendre',
  recherche: 'Nouvelle demande de recherche',
};

// Libellés lisibles pour l'email et le tableau de bord
const LIBELLES = { type: 'Type de bien', commune: 'Commune', surface: 'Surface (m²)', prix: 'Prix souhaité', budget: 'Budget', objet: 'Objet', message: 'Message', criteres: 'Critères' };

// ── Anti-spam ────────────────────────────────────────────────────────────────
// Un vrai client n'a aucune raison de mettre un lien dans sa demande : les arnaques
// (hameçonnage, faux « document partagé ») en contiennent presque toujours un.
const LIEN = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:online|site|xyz|top|click|link|shop|store|live|icu|info|biz|ru|cn|id|io|me|ly|gl|co|com|net|org|fr)\/\S*/i;
// Extensions d'e-mail gratuites très utilisées par les robots de spam
const EMAIL_SUSPECT = /@[^@\s]+\.(?:my\.id|biz\.id|web\.id|xyz|top|click|icu|online|site|ru|cn)$/i;
const DELAI_MIN_MS = 3000;

function raisonSpam(champs) {
  if (clip(champs._hp)) return 'champ piège rempli';
  const t = Number(champs._t);
  if (!Number.isFinite(t)) return 'envoi direct sans passer par le site';
  if (t < DELAI_MIN_MS) return `formulaire rempli en ${t} ms`;
  const texte = [champs.message, champs.objet, champs.criteres, champs.nom, champs.commune].map(v => String(v ?? '')).join(' ');
  if (LIEN.test(texte)) return 'lien dans le message';
  if (EMAIL_SUSPECT.test(clip(champs.email))) return 'adresse e-mail suspecte';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    if (await limiteAtteinte(req, 'lead', 10)) return res.status(429).json({ ok: false, error: 'Trop de demandes' });

    const body = parseBody(req);
    const sujet = SUJETS[body.formulaire];
    const champs = { ...(body.champs || {}) };
    if (!sujet || !clip(champs.nom) || !clip(champs.tel)) return res.status(400).json({ ok: false, error: 'Données manquantes' });

    // Spam : on répond « ok » pour ne pas aider le robot à s'adapter, mais rien n'est transmis
    const spam = raisonSpam(champs);
    if (spam) {
      console.warn(`lead bloqué (${spam}) :`, clip(champs.email, 80), clip(champs.message, 120));
      return res.status(200).json({ ok: true });
    }
    delete champs._hp;
    delete champs._t;

    const formspree = { _subject: `[Toan Immo] ${sujet}` };
    for (const [k, v] of Object.entries(champs).slice(0, 20)) formspree[clip(k, 40)] = clip(v, 2000);

    const details = {};
    for (const [k, libelle] of Object.entries(LIBELLES)) if (clip(champs[k])) details[libelle] = clip(champs[k], 2000);

    const ok = await traiterLead({
      type: body.formulaire,
      prenom: '',
      nom: champs.nom,
      tel: champs.tel,
      email: champs.email,
      commune: champs.commune,
      source: champs.source,
      resume: clip(champs.message || champs.criteres || champs.objet, 300),
      details,
      formspree,
    });
    if (!ok) throw new Error('aucun canal disponible');
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead:', e);
    res.status(500).json({ ok: false, error: 'Envoi impossible' });
  }
}

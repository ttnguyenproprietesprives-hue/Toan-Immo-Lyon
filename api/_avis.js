// Mise à jour automatique des notes et nombres d'avis affichés sur le site (non exposé comme route : préfixe "_").
//  - Immodvisor : lu chaque matin sur la page publique (données structurées schema.org « AggregateRating »).
//  - Google : lu via l'API officielle Google Places si la variable GOOGLE_PLACES_API_KEY est définie sur Vercel ;
//    sinon, la dernière valeur saisie à la main dans le tableau de bord est conservée.
// Les valeurs sont stockées dans Upstash (clé « avis ») et lues par la page d'accueil via /api/relances?avis=1.

const PAGE_IMMODVISOR = 'https://www.immodvisor.com/professionnels/mandataire-immobilier/pro/proprietes-privees-trung-toam-nguyen-36743';
const RECHERCHE_GOOGLE = 'Immobilier Toam NGUYEN-Proprietes-Privees.com Jonage';

// Valeurs de départ (relevées le 14/11/2026), utilisées tant que rien n'a encore été enregistré
const PAR_DEFAUT = {
  immodvisor: { note: 4.8, nb: 37, maj: '2026-11-14T00:00:00Z', source: 'relevé manuel' },
  google: { note: 5.0, nb: 18, maj: '2026-11-14T00:00:00Z', source: 'relevé manuel' },
};

function valide(note, nb) {
  return Number.isFinite(note) && note >= 1 && note <= 5 && Number.isInteger(nb) && nb >= 0 && nb < 100000;
}

export async function lireAvis(r) {
  const enregistre = (await r.get('avis')) || {};
  return { immodvisor: enregistre.immodvisor || PAR_DEFAUT.immodvisor, google: enregistre.google || PAR_DEFAUT.google };
}

async function avisImmodvisor() {
  const rep = await fetch(PAGE_IMMODVISOR, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ToanImmoLyon/1.0)', 'Accept-Language': 'fr-FR' } });
  if (!rep.ok) throw new Error('Immodvisor ' + rep.status);
  const html = await rep.text();
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json;
    try { json = JSON.parse(m[1]); } catch (e) { continue; }
    const pile = [json];
    while (pile.length) {
      const o = pile.pop();
      if (!o || typeof o !== 'object') continue;
      const a = o.aggregateRating;
      if (a && a.ratingValue != null) {
        const note = Number(String(a.ratingValue).replace(',', '.'));
        const nb = parseInt(a.reviewCount ?? a.ratingCount, 10);
        if (valide(note, nb)) return { note, nb };
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') pile.push(v);
    }
  }
  throw new Error('Immodvisor : note introuvable dans la page');
}

async function avisGoogle(r) {
  const cle = process.env.GOOGLE_PLACES_API_KEY;
  if (!cle) return null;
  let placeId = process.env.GOOGLE_PLACE_ID || (await r.get('avis:google_place_id'));
  if (!placeId) {
    const rech = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': 'places.id,places.displayName' },
      body: JSON.stringify({ textQuery: RECHERCHE_GOOGLE, languageCode: 'fr' }),
    });
    const d = await rech.json();
    if (!rech.ok) throw new Error('Google Places (recherche) : ' + (d.error?.message || rech.status));
    const fiche = (d.places || []).find(p => /nguyen/i.test(p.displayName?.text || '')) || (d.places || [])[0];
    if (!fiche) throw new Error('Google Places : fiche introuvable');
    placeId = fiche.id;
    await r.set('avis:google_place_id', placeId);
  }
  const rep = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': 'rating,userRatingCount' },
  });
  const d = await rep.json();
  if (!rep.ok) throw new Error('Google Places : ' + (d.error?.message || rep.status));
  const note = Number(d.rating), nb = parseInt(d.userRatingCount, 10);
  if (!valide(note, nb)) throw new Error('Google Places : valeurs inattendues');
  return { note, nb };
}

// Appelé chaque matin par le planificateur (et à la demande depuis le tableau de bord)
export async function majAvis(r) {
  const actuel = await lireAvis(r);
  const maintenant = new Date().toISOString();
  const bilan = {};
  try {
    const i = await avisImmodvisor();
    actuel.immodvisor = { ...i, maj: maintenant, source: 'automatique' };
    bilan.immodvisor = `${i.note}/5 · ${i.nb} avis`;
  } catch (e) {
    bilan.immodvisor = 'non mis à jour : ' + e.message;
  }
  try {
    const g = await avisGoogle(r);
    if (g) {
      actuel.google = { ...g, maj: maintenant, source: 'automatique' };
      bilan.google = `${g.note}/5 · ${g.nb} avis`;
    } else bilan.google = 'saisie manuelle (pas de clé GOOGLE_PLACES_API_KEY)';
  } catch (e) {
    bilan.google = 'non mis à jour : ' + e.message;
  }
  await r.set('avis', actuel);
  return bilan;
}

// Saisie manuelle depuis le tableau de bord (Google, ou Immodvisor en secours)
export async function saisirAvis(r, plateforme, note, nb) {
  if (!['google', 'immodvisor'].includes(plateforme)) throw new Error('Plateforme inconnue');
  note = Number(String(note).replace(',', '.'));
  nb = parseInt(nb, 10);
  if (!valide(note, nb)) throw new Error('Note (1 à 5) ou nombre d\'avis invalide');
  const actuel = await lireAvis(r);
  actuel[plateforme] = { note, nb, maj: new Date().toISOString(), source: 'saisie manuelle' };
  await r.set('avis', actuel);
  return actuel;
}

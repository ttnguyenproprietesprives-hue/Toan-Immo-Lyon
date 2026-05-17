export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prenom, tel, email, msg, commune, type, surface, estimation } = req.body;

  try {
    // Envoi via Formspree — remplace XXXX par ton ID Formspree
    await fetch('https://formspree.io/f/' + process.env.FORMSPREE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Prénom: prenom,
        Téléphone: tel,
        Email: email || 'Non renseigné',
        Message: msg || 'Aucun message',
        Commune: commune,
        'Type de bien': type,
        Surface: surface,
        Estimation: estimation,
        Source: 'Outil estimation Toan Immo Lyon'
      })
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    // On répond quand même OK pour ne pas bloquer l'UI
    res.status(200).json({ ok: true });
  }
}

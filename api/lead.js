export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Reformater proprement sans emojis pour Formspree
    const payload = {
      _subject: `Nouveau lead – ${body['PROJET'] || 'Estimation'} – ${body['Commune'] || ''}`,
      Projet: body['PROJET'] || '',
      Civilite: body['Civilité'] || '',
      Prenom: body['Prénom'] || '',
      Nom: body['Nom'] || '',
      Telephone: body['Téléphone'] || '',
      Email: body['Email'] || '',
      Delai: body['Délai'] || '',
      Financement: body['Financement'] || '',
      Budget: body['Budget'] || '',
      Apport: body['Apport'] || '',
      Adresse: body['Adresse'] || '',
      Commune: body['Commune'] || '',
      Environnement: body['Environnement'] || '',
      Type_bien: body['Type de bien'] || '',
      Pieces: body['Pièces'] || '',
      Surface: body['Surface'] || '',
      SDB: body['SDB'] || '',
      Etages: body['Étages'] || '',
      Construction: body['Construction'] || '',
      Etat: body['État'] || '',
      DPE: body['DPE'] || '',
      Chauffage: body['Chauffage'] || '',
      Etage: body['Étage'] || '',
      Exposition: body['Exposition'] || '',
      Vue: body['Vue'] || '',
      Luminosite: body['Luminosité'] || '',
      Parking: body['Parking'] || '',
      Exterieur: body['Extérieur'] || '',
      Ascenseur: body['Ascenseur'] || '',
      Cave: body['Cave'] || '',
      Cuisine: body['Cuisine'] || '',
      Clim: body['Clim'] || '',
      Parquet: body['Parquet'] || '',
      ESTIMATION: body['ESTIMATION'] || '',
      Fourchette: body['Fourchette'] || '',
      Prix_m2: body['Prix m²'] || '',
      Tendance: body['Tendance'] || '',
      Source: 'Toan Immo Lyon – Outil estimation'
    };

    const response = await fetch('https://formspree.io/f/' + process.env.FORMSPREE_ID, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    res.status(200).json({ ok: true, formspree: result });
  } catch(e) {
    res.status(200).json({ ok: true, error: e.message });
  }
}

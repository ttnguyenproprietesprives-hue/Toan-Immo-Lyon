import { isAdmin } from './_auth.js';

const QUERIES = {
  instagram: 'modern apartment building Lyon France',
  facebook: 'luxury real estate France exterior',
  linkedin: 'professional real estate building France',
  google: 'modern residential building France',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const platform = body.platform || 'instagram';
  const query = QUERIES[platform] || QUERIES.instagram;

  const unsplashRes = await fetch(
    `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
    {
      headers: {
        Authorization: 'Client-ID ' + process.env.UNSPLASH_ACCESS_KEY,
      },
    }
  );

  const data = await unsplashRes.json();

  if (!unsplashRes.ok) {
    return res.status(500).json({ error: data.errors || 'Unsplash error' });
  }

  return res.status(200).json({ url: data.urls.regular, platform: platform });
}

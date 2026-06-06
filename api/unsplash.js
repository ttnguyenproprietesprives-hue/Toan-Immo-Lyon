export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { query } = req.query;
  const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
  try {
    const r = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${ACCESS_KEY}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.errors });
    res.status(200).json({
      url: data.urls.regular,
      thumb: data.urls.small,
      author: data.user.name,
      author_url: data.user.links.html
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

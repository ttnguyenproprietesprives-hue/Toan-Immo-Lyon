export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { query } = req.query;
  const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

  try {
    const r = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${ACCESS_KEY}` } }
    );
    const data = await r.json();
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'No photo found' });
    }
    const photo = data.results[0];
    res.status(200).json({
      url: photo.urls.regular,
      thumb: photo.urls.small,
      author: photo.user.name,
      author_url: photo.user.links.html
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

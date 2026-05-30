export const config = { runtime: 'edge' };

const QUERIES = {
  instagram: 'modern apartment building Lyon France',
  facebook: 'luxury real estate France exterior',
  linkedin: 'professional real estate building France',
  google: 'modern residential building France',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const body = await req.json();
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
    return new Response(JSON.stringify({ error: data.errors || 'Unsplash error' }), { status: 500 });
  }

  return new Response(JSON.stringify({ url: data.urls.regular, platform: platform }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

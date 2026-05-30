export const config = { runtime: 'edge' };

const PLATFORM_SIZES = {
  instagram: '1024x1024',
  facebook: '1792x1024',
  linkedin: '1792x1024',
  google: '1024x1024',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const body = await req.json();
  const platform = body.platform || 'instagram';

  const prompt = 'Professional real estate marketing photo. Modern French residential building exterior, bright natural light, clean architecture, no people, no text, no logos, photorealistic, high quality. Warm tones, blue sky, green trees.';

  const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: PLATFORM_SIZES[platform] || '1024x1024',
      quality: 'standard',
      response_format: 'url',
    }),
  });

  const data = await openaiRes.json();

  if (!openaiRes.ok) {
    return new Response(JSON.stringify({ 
      error: data.error,
      status: openaiRes.status,
      keyPresent: !!process.env.OPENAI_API_KEY
    }), { status: 500 });
  }

  return new Response(JSON.stringify({ url: data.data[0].url, platform: platform }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

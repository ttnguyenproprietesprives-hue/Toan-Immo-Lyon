export const config = { runtime: 'edge' };

const PLATFORM_SIZES = {
  instagram: '1024x1024',
  facebook: '1792x1024',
  linkedin: '1792x1024',
  google: '1024x1024',
};

const PLATFORM_STYLE = {
  instagram: 'square format, bold visual, minimal text overlay space at bottom',
  facebook: 'wide landscape format, welcoming scene',
  linkedin: 'professional wide landscape, clean corporate aesthetic',
  google: 'square format, local neighborhood feel',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { sujet, commune, platform, saison } = await req.json();

  if (!sujet || !commune || !platform) {
    return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 });
  }

  const communeName = commune.split(' (')[0];

  const prompt = `Professional real estate marketing photo for Lyon metropolitan area, France.
Subject: ${sujet} in ${communeName}, ${saison}.
Style: ${PLATFORM_STYLE[platform] || 'modern and professional'}.
Mood: bright, aspirational, trustworthy French real estate.
Scene: Beautiful residential street or apartment building in ${communeName}, Lyon area, golden hour light, no text, no people, photorealistic, high quality.
Color palette: warm whites, stone facades, green trees, blue sky.
Do NOT include: text, logos, watermarks, people's faces.`;

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: PLATFORM_SIZES[platform] || '1024x1024',
        quality: 'standard',
        response_format: 'url',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI API error');
    }

    return new Response(JSON.stringify({
      url: data.data[0].url,
      platform,
      revised_prompt: data.data[0].revised_prompt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('generate-image error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

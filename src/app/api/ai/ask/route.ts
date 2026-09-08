import { askAI } from '@/lib/aiInsights';

const PRESETS: Record<string, string> = {
  trends: 'Analyze my spending trends over the available months. Point out any categories trending up or down, and anything notable.',
  budget_risks: 'Based on my current-month spend vs budget for each category, which am I at risk of going over on, and by roughly how much at this pace?',
  category_breakdown: 'Give me a breakdown of where my money went this month by category, highlighting the biggest chunks of spending.',
};

export async function POST(request: Request) {
  const { question, preset } = await request.json();

  const prompt = preset && PRESETS[preset] ? PRESETS[preset] : question;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return Response.json({ error: 'Provide a question or a valid preset.' }, { status: 400 });
  }

  try {
    const result = await askAI(prompt.trim());
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

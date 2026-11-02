// Plain text generation with Gemini when GEMINI_API_KEY is set, otherwise Claude.
// (Label photo analysis lives in analyze.ts.)

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
type AnthropicResponse = { content?: { type: string; text?: string }[] };

export type LlmImage = { data: Buffer; mediaType: string };

// Gemini caps a request near 20 MB and Claude caps an image near 5 MB (after base64).
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

export async function generateText(prompt: string, images: LlmImage[] = []): Promise<string> {
  const pics = images.filter((i) => i.data.length <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES);
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const model = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").replace(/^models\//, "");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": geminiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                ...pics.map((i) => ({ inline_data: { mime_type: i.mediaType, data: i.data.toString("base64") } })),
                { text: prompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8000 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as GeminiResponse;
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY or ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            ...pics.map((i) => ({
              type: "image",
              source: { type: "base64", media_type: i.mediaType, data: i.data.toString("base64") },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as AnthropicResponse;
  return (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

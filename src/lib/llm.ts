// Plain text generation with Gemini when GEMINI_API_KEY is set, otherwise Claude.
// (Label photo analysis lives in analyze.ts.)

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
type AnthropicResponse = { content?: { type: string; text?: string }[]; stop_reason?: string };

/** Prefix of the error when the model ran out of room before answering; callers can retry with a shorter prompt. */
export const TOO_LONG = "[ran-out-of-room] ";

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
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 12000,
            // Gemini 2.5 "thinking" tokens count against the output limit and can leave nothing for the answer.
            ...(/flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as GeminiResponse & { promptFeedback?: { blockReason?: string } };
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim()) {
      const why = body.promptFeedback?.blockReason ?? (body.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason ?? "no reason given";
      throw new Error(`Gemini returned an empty answer (${why}). Try again.`);
    }
    return text;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY or ANTHROPIC_API_KEY");
  const send = (withoutThinking: boolean) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 8000,
        // Thinking tokens count against max_tokens, and on a long label the model can think until nothing is left for the answer.
        ...(withoutThinking ? { thinking: { type: "disabled" } } : {}),
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
  let res = await send(true);
  if (res.status === 400 && /thinking/i.test(await res.clone().text())) res = await send(false); // model doesn't take the switch
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as AnthropicResponse;
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    const blocks = (body.content ?? []).map((b) => b.type).join(", ") || "none";
    throw new Error(`${body.stop_reason === "max_tokens" ? TOO_LONG : ""}Claude returned no text (stop reason: ${body.stop_reason ?? "unknown"}; content blocks: ${blocks}). Try again.`);
  }
  return text;
}

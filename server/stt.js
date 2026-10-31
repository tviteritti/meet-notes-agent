export async function transcribeWav(wav, apiKey, model, language) {
  const form = new FormData();
  form.append("file", new File([wav], "audio.wav", { type: "audio/wav" }));
  form.append("model", model);
  form.append("temperature", "0");
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq ${response.status}: ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  return data.text || "";
}

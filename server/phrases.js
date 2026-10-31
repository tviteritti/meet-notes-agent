const OFFER = /comparto|compartir (la )?pantalla|pantalla compartida|te muestro|les muestro|estoy mostrando|mir[aá] (esto|la pantalla|el diagrama)/i;
const CHECK = /se ve\??|lo ven\??|se est[aá] viendo|ah[ií] se ve|pueden ver|llega la imagen/i;

const HALLUCINATIONS = [
  /gracias por ver/i,
  /subt[ií]tulos realizad/i,
  /suscr[ií]bete/i,
  /amara\.org/i,
  /thanks for watching/i,
  /^\W*$/,
];

export function clip(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
}

export function shotRequest(text) {
  if (CHECK.test(text)) {
    return { reason: `preguntaron si se ve: “${clip(text)}”`, delayMs: 400, priority: true };
  }
  if (OFFER.test(text)) {
    return { reason: `ofrecieron compartir: “${clip(text)}”`, delayMs: 2000, priority: false };
  }
  return null;
}

export function isHallucination(text) {
  const t = (text || "").trim();
  if (t.length < 2) return true;
  return HALLUCINATIONS.some((re) => re.test(t)) && t.length < 90;
}

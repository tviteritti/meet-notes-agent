export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\(tu\)|\(you\)/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function samePerson(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function tokens(text) {
  return new Set(
    normalizeName(text)
      .split(" ")
      .filter((word) => word.length > 2),
  );
}

export function speakerFromCaptions(text, t0, t1, captions) {
  const mine = tokens(text);
  if (!mine.size) return null;
  let best = null;
  let bestScore = 0;
  for (const caption of captions) {
    if (!caption.name || caption.t < t0 - 5000 || caption.t > t1 + 5000) continue;
    const theirs = tokens(caption.text);
    let hit = 0;
    for (const word of mine) if (theirs.has(word)) hit += 1;
    const score = hit / mine.size;
    if (score > bestScore) {
      bestScore = score;
      best = caption.name;
    }
  }
  return bestScore >= 0.34 ? best : null;
}

export function activeSpeakerName(t0, t1, events) {
  let best = null;
  let bestMs = 0;
  for (let i = 0; i < events.length; i++) {
    const start = Math.max(events[i].t, t0);
    const end = Math.min(i + 1 < events.length ? events[i + 1].t : t1, t1);
    const overlap = end - start;
    if (overlap > bestMs && events[i].name) {
      bestMs = overlap;
      best = events[i].name;
    }
  }
  return best;
}

export function nameTabSegment({ text, t0, t1, captions, speakerEvents, selfName }) {
  const fromText = speakerFromCaptions(text, t0, t1, captions);
  if (fromText) return { speaker: fromText, drop: samePerson(fromText, selfName) };

  const fromDom = activeSpeakerName(t0, t1, speakerEvents);
  if (fromDom) return { speaker: fromDom, drop: samePerson(fromDom, selfName) };

  const close = captions.filter(
    (caption) => caption.name && caption.t >= t0 - 1000 && caption.t <= t1 + 1000,
  );
  const last = close.at(-1);
  if (last) return { speaker: last.name, drop: samePerson(last.name, selfName) };
  return { speaker: "Otro", drop: false };
}

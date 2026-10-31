const NAME = /\btami\b/i;

export function mentionsTami(text) {
  return NAME.test(String(text || ""));
}

export function buildPrompt(lines, question, projectName) {
  const recent = lines.slice(-25).map((line) => `${line.speaker}: ${line.text}`).join("\n");
  return [
    `Sos TAMI en una reunión del proyecto ${projectName}.`,
    "Respondé en español, en pocas oraciones, como si lo dijeras en voz alta.",
    "Respondé solo lo que está en Te dijeron. La transcripción puede juntar varias frases en una sola.",
    "No edites archivos ni ejecutes comandos. Buscá en el código solo si la pregunta lo necesita.",
    "",
    "Transcripción reciente:",
    recent || "(todavía no hay)",
    "",
    "Te dijeron:",
    question,
  ].join("\n");
}

function latestFresh(text, after) {
  let index = -1;
  for (const match of String(text || "").matchAll(/\btami\b/ig)) {
    if (match.index > after) index = match.index;
  }
  return index;
}

export function questionAt(text, index) {
  const rest = String(text || "").slice(index);
  const next = rest.slice(1).search(/\btami\b/i);
  return (next === -1 ? rest : rest.slice(0, next + 1)).trim();
}

function isBareWake(text) {
  const words = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "tami" && !["hola", "che", "hey", "ey", "eh", "bueno"].includes(word));
  return words.length === 0;
}

function cleanQuestion(text) {
  return String(text || "").replace(/^[\s,;:.¿¡!?-]+/, "").trim();
}

export function createTami({ ask, onAnswer, projectName, delayMs = 1000, listenMs = 15000 }) {
  let timer = null;
  let waiting = null;
  let ear = null;
  let generation = 0;
  let chain = Promise.resolve();

  function arm(job) {
    const same = waiting
      && waiting.kind === job.kind
      && waiting.segment === job.segment
      && waiting.index === job.index
      && waiting.extraFrom === job.extraFrom;
    if (!same) generation += 1;
    job.gen = generation;
    waiting = job;
    clearTimeout(timer);
    timer = setTimeout(fire, delayMs);
  }

  function askQuestion(job, question) {
    const gen = job.gen;
    const prompt = buildPrompt(job.transcriptFn(), question, projectName);
    chain = chain.then(async () => {
      if (gen !== generation) return;
      let answer = "No pude consultar el proyecto.";
      try {
        const text = String(await ask(prompt) || "").trim();
        if (text) answer = text;
      } catch {
        answer = "No pude consultar el proyecto.";
      }
      if (gen !== generation) return;
      onAnswer(answer, job.segment.t1 || Date.now());
    });
  }

  function fire() {
    const job = waiting;
    waiting = null;
    timer = null;
    if (!job || job.gen !== generation) return;
    if (job.kind === "wake") {
      if ((job.segment.tamiUpto ?? -1) >= job.index) return;
      const question = questionAt(job.segment.text, job.index);
      if (!mentionsTami(question)) return;
      if (isBareWake(question)) {
        job.segment.tamiUpto = job.segment.text.length;
        ear = {
          speaker: job.segment.speaker,
          segment: job.segment,
          from: job.segment.text.length,
          until: Date.now() + listenMs,
        };
        onAnswer("Sí, decime.", job.segment.t1 || Date.now());
        return;
      }
      job.segment.tamiUpto = job.index;
      ear = null;
      onAnswer("Estoy en eso.", job.segment.t1 || Date.now());
      askQuestion(job, question);
      return;
    }
    if (!ear || Date.now() > ear.until) return;
    const question = cleanQuestion(job.segment.text.slice(job.extraFrom));
    if (question.length < 3 || isBareWake(question)) return;
    ear = null;
    job.segment.tamiUpto = Math.max(job.segment.tamiUpto ?? -1, job.segment.text.length);
    onAnswer("Estoy en eso.", job.segment.t1 || Date.now());
    askQuestion(job, question);
  }

  return {
    notice(segment, transcriptFn) {
      const index = latestFresh(segment.text, segment.tamiUpto ?? -1);
      if (index >= 0) {
        arm({ kind: "wake", segment, transcriptFn, index, extraFrom: -1 });
        return null;
      }
      if (!ear || Date.now() > ear.until || segment.speaker !== ear.speaker) return null;
      const extraFrom = segment === ear.segment ? ear.from : 0;
      const extra = cleanQuestion(segment.text.slice(extraFrom));
      if (extra.length < 3 || isBareWake(extra)) return null;
      arm({ kind: "follow", segment, transcriptFn, index: -1, extraFrom });
      return null;
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
      waiting = null;
      ear = null;
      generation += 1;
    },
  };
}

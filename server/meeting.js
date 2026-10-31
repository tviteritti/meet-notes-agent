import fs from "node:fs";
import path from "node:path";
import { samePerson } from "./align.js";
import { shotRequest } from "./phrases.js";
import { askCursor } from "./cursor.js";
import { countTurns, renderNotes } from "./notes.js";
import { ensureRule } from "./rule.js";
import { createTami } from "./tami.js";

function meetingId(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function uniqueId(parent, base) {
  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(parent, id))) id = `${base}-${n++}`;
  return id;
}

export function openMeeting({ projectPath, projectName, userName, ask, tamiDelayMs = 1000, onSpeak }) {
  const startedAt = new Date();
  const meetingsDir = path.join(projectPath, "meetings");
  fs.mkdirSync(meetingsDir, { recursive: true });
  const id = uniqueId(meetingsDir, meetingId(startedAt));
  const dir = path.join(meetingsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  ensureRule(projectPath);

  const meeting = {
    id,
    dir,
    projectPath,
    projectName,
    userName,
    selfName: "",
    startedAt: startedAt.getTime(),
    endedAt: null,
    segments: [],
    captions: [],
    speakerEvents: [],
    frames: [],
    closed: false,
  };

  let lastCapture = 0;
  let lastError = "";
  const captures = [];

  function recentLines() {
    return meeting.segments.slice(-25).map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
    }));
  }

  function sayTami(text, t) {
    const spoken = String(text || "").replace(/\s+/g, " ").trim();
    if (!spoken) return;
    meeting.segments.push({
      t0: t,
      t1: t,
      track: "tami",
      speaker: "TAMI",
      text: spoken,
    });
    writeFiles();
    if (onSpeak) onSpeak(spoken);
  }

  const tami = createTami({
    ask: ask || ((prompt) => askCursor({ workspace: projectPath, prompt })),
    projectName,
    delayMs: tamiDelayMs,
    onAnswer(text, t) {
      sayTami(text, t);
    },
  });

  function noteTami(segment) {
    const reaction = tami.notice(segment, recentLines);
    if (reaction) sayTami(reaction, segment.t1 || Date.now());
  }

  function writeFiles() {
    const { mine, others } = countTurns(meeting);
    const body = (prefix) => renderNotes(meeting, { closed: meeting.closed, imagePrefix: prefix });
    fs.writeFileSync(path.join(dir, "notas.md"), body(""), "utf8");
    fs.writeFileSync(path.join(meetingsDir, "en-curso.md"), body(`${id}/`), "utf8");
    const transcript = meeting.segments.map((segment) => JSON.stringify(segment)).join("\n");
    fs.writeFileSync(path.join(dir, "transcript.jsonl"), transcript ? `${transcript}\n` : "", "utf8");
    const indexPath = path.join(meetingsDir, "index.jsonl");
    const rows = fs.existsSync(indexPath)
      ? fs.readFileSync(indexPath, "utf8").split("\n").filter(Boolean).map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        })
      : [];
    const entry = {
      id,
      proyecto: projectName,
      inicio: new Date(meeting.startedAt).toISOString(),
      fin: meeting.endedAt ? new Date(meeting.endedAt).toISOString() : null,
      carpeta: `meetings/${id}`,
      intervencionesVos: mine,
      intervencionesOtros: others,
      capturas: meeting.frames.length,
    };
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows[index] = entry;
    else rows.push(entry);
    fs.writeFileSync(indexPath, `${rows.map((row) => row.raw || JSON.stringify(row)).join("\n")}\n`, "utf8");
  }

  function requestCapture(request) {
    const now = Date.now();
    const wait = request.priority ? 1200 : 6000;
    if (now - lastCapture < wait) return;
    lastCapture = now;
    captures.push(request);
  }

  function rememberSpeaker(name, t) {
    if (!name) return;
    const last = meeting.speakerEvents.at(-1);
    if (last && samePerson(last.name, name)) return;
    meeting.speakerEvents.push({ t, name });
    fs.appendFileSync(path.join(dir, "speakers.jsonl"), `${JSON.stringify({ t, name })}\n`, "utf8");
  }

  function labelSpeaker(name) {
    const clean = (name || "").trim();
    if (/^(t[uú]|you|vos)$/i.test(clean)) return meeting.selfName || meeting.userName || "Tú";
    return clean || "Otro";
  }

  function norm(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function continues(previous, next) {
    const before = norm(previous);
    const after = norm(next);
    if (!before || !after) return false;
    if (after.startsWith(before) || before.startsWith(after)) return true;
    const limit = Math.min(before.length, after.length);
    let same = 0;
    while (same < limit && before[same] === after[same]) same += 1;
    return limit >= 24 && same / limit >= 0.65;
  }

  function applyCaptions(items, t, baseline) {
    let changed = false;
    for (const item of items) {
      const text = String(item?.text || "").replace(/\s+/g, " ").trim();
      const speaker = labelSpeaker(item?.name);
      if (text.length < 2) continue;
      let match = null;
      for (let i = meeting.segments.length - 1; i >= 0; i--) {
        const segment = meeting.segments[i];
        if (segment.track === "caption" && segment.speaker === speaker) {
          match = segment;
          break;
        }
      }
      if (match && continues(match.text, text)) {
        if (text.length >= match.text.length) {
          match.text = text;
          match.t1 = t;
          changed = true;
          if (baseline) match.tamiUpto = text.length;
          else noteTami(match);
        }
        continue;
      }
      const segment = { t0: t, t1: t, track: "caption", speaker, text };
      if (baseline) segment.tamiUpto = text.length;
      meeting.segments.push(segment);
      changed = true;
      if (!baseline) {
        noteTami(segment);
        const shot = shotRequest(text);
        if (shot) requestCapture(shot);
      }
    }
    if (changed) writeFiles();
  }

  function addFrame(msg) {
    const jpeg = Buffer.from(msg.jpegBase64 || "", "base64");
    if (jpeg.length < 1000) return;
    const file = `frames/${String(meeting.frames.length + 1).padStart(3, "0")}.jpg`;
    fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
    fs.writeFileSync(path.join(dir, file), jpeg);
    meeting.frames.push({ t: msg.t || Date.now(), reason: msg.reason || "captura", file });
    writeFiles();
  }

  writeFiles();

  return {
    id,
    dir,
    projectName,
    get lastLine() {
      const segment = meeting.segments.at(-1);
      return segment ? `${segment.speaker}: ${segment.text}` : "";
    },
    get lines() {
      return meeting.segments.length;
    },
    get frames() {
      return meeting.frames.length;
    },
    get error() {
      return lastError;
    },
    takeCaptures() {
      return captures.splice(0, captures.length);
    },
    async push(msg) {
      if (meeting.closed) return;
      if (msg.type === "self" && msg.name) {
        meeting.selfName = msg.name.trim();
        let changed = false;
        for (const segment of meeting.segments) {
          if (/^(t[uú]|you|vos)$/i.test(segment.speaker) || segment.speaker === (meeting.userName || "Vos")) {
            segment.speaker = meeting.selfName;
            changed = true;
          }
        }
        if (changed) writeFiles();
        return;
      }
      if (msg.type === "speaker") {
        rememberSpeaker(msg.name, msg.t || Date.now());
        return;
      }
      if (msg.type === "caption" || msg.type === "captions") {
        const items = Array.isArray(msg.items) ? msg.items : [{ name: msg.name, text: msg.text }];
        applyCaptions(items, msg.t || Date.now(), Boolean(msg.baseline));
        return;
      }
      if (msg.type === "presenting" && msg.active) {
        rememberSpeaker(msg.name, msg.t || Date.now());
        requestCapture({
          reason: `${msg.name || "Alguien"} está compartiendo pantalla`,
          delayMs: 800,
          priority: true,
        });
        return;
      }
      if (msg.type === "audio") return;
      if (msg.type === "frame") addFrame(msg);
    },
    async finish() {
      if (meeting.closed) return;
      tami.cancel();
      meeting.closed = true;
      meeting.endedAt = Date.now();
      writeFiles();
    },
  };
}

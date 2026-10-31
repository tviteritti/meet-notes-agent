import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { nameTabSegment } from "../server/align.js";
import { openMeeting } from "../server/meeting.js";
import { shotRequest } from "../server/phrases.js";
import { createServer } from "../server/index.js";
import { encodeWav } from "../server/wav.js";

test("el nombre sale de los subtítulos y, si no, de quién está activo", () => {
  const captions = [{ t: 1_000, name: "Ana", text: "el deploy sale el viernes" }];
  const byCaption = nameTabSegment({
    text: "el deploy sale el viernes",
    t0: 800,
    t1: 2_000,
    captions,
    speakerEvents: [{ t: 0, name: "Luis" }],
    selfName: "Tomas",
  });
  assert.equal(byCaption.speaker, "Ana");
  assert.equal(byCaption.drop, false);

  const byDom = nameTabSegment({
    text: "ok",
    t0: 5_000,
    t1: 6_000,
    captions: [],
    speakerEvents: [
      { t: 0, name: "Luis" },
      { t: 4_500, name: "Ana" },
    ],
    selfName: "",
  });
  assert.equal(byDom.speaker, "Ana");

  const mine = nameTabSegment({
    text: "yo lo miro",
    t0: 1_000,
    t1: 2_000,
    captions: [{ t: 1_000, name: "Tomas (Tú)", text: "yo lo miro ahora" }],
    speakerEvents: [],
    selfName: "Tomas",
  });
  assert.equal(mine.drop, true);
});

test("la captura se pide cuando hablan de la pantalla", () => {
  assert.equal(shotRequest("¿ahí se ve?")?.priority, true);
  assert.equal(shotRequest("te comparto pantalla")?.priority, false);
  assert.equal(shotRequest("el endpoint ya está"), null);
});

test("una reunión escribe los subtítulos y no el audio", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reuniones-"));
  const project = path.join(root, "1-proyecto-x");
  fs.mkdirSync(project);
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto x",
    userName: "Vos",
  });
  await meeting.push({
    type: "captions",
    t: 1_000,
    items: [{ name: "Tú", text: "No. Okay." }],
  });
  await meeting.push({
    type: "captions",
    t: 1_400,
    items: [
      { name: "Tú", text: "No. Okay. But uh." },
      { name: "Ana", text: "otro canto" },
    ],
  });
  await meeting.push({
    type: "audio",
    track: "mic",
    t0: 2_000,
    t1: 3_000,
    wavBase64: encodeWav(Float32Array.from({ length: 16000 }, () => 0.2)).toString("base64"),
  });
  await meeting.push({
    type: "captions",
    t: 2_200,
    items: [{ name: "Tú", text: "no" }],
  });
  await meeting.push({
    type: "captions",
    t: 2_600,
    items: [{ name: "Tú", text: "No te encuentro. Viendo la ciudad." }],
  });
  await meeting.finish();

  const live = fs.readFileSync(path.join(project, "meetings", "en-curso.md"), "utf8");
  assert.match(live, /estado: cerrada/);
  assert.match(live, /\*\*Vos:\*\* No\. Okay\. But uh\./);
  assert.match(live, /\*\*Ana:\*\* otro canto/);
  assert.doesNotMatch(live, /No\. Okay\.\*\*/);
  const saved = fs.readdirSync(path.join(project, "meetings")).filter((name) => name !== "en-curso.md" && name !== "index.jsonl");
  const transcript = fs.readFileSync(path.join(project, "meetings", saved[0], "transcript.jsonl"), "utf8");
  assert.match(transcript, /No\. Okay\. But uh\./);
  assert.match(live, /\*\*Vos:\*\* No te encuentro\. Viendo la ciudad\./);
  assert.equal(transcript.split("\n").filter(Boolean).length, 3);
});

test("el servidor recibe audio y lo deja en el proyecto elegido", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reuniones-srv-"));
  const project = path.join(root, "2-api");
  fs.mkdirSync(project);
  const app = createServer({
    projectsRoot: root,
    config: { port: 0, userName: "Vos", extraProjects: [] },
    apiKey: "test",
    transcribe: async () => "listo el cambio",
  });
  const port = await app.listen(0);
  try {
    const status = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const body = await status.json();
    assert.equal(body.projects.some((item) => item.folder === "2-api"), true);

    const result = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", projectPath: project })));
      ws.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ready") {
          ws.send(JSON.stringify({
            type: "captions",
            t: Date.now(),
            items: [{ name: "Tú", text: "listo el cambio" }],
          }));
          ws.send(JSON.stringify({ type: "stop" }));
        }
        if (msg.type === "closed") {
          ws.close();
          resolve(msg);
        }
        if (msg.type === "error") reject(new Error(msg.message));
      });
      ws.on("error", reject);
    });
    assert.equal(result.type, "closed");
    const live = fs.readFileSync(path.join(project, "meetings", "en-curso.md"), "utf8");
    assert.match(live, /listo el cambio/);
  } finally {
    await app.close();
  }
});

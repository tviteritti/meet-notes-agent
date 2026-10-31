import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { createServer } from "../server/index.js";
import { openMeeting } from "../server/meeting.js";
import { mentionsTami } from "../server/tami.js";

test("TAMI reacciona al toque y consulta una sola vez con la frase completa", async () => {
  assert.equal(mentionsTami("TAMI, dónde está el login"), true);
  assert.equal(mentionsTami("tamices de la tela"), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-"));
  const project = path.join(root, "proyecto");
  fs.mkdirSync(project);
  const seen = [];
  const spoken = [];
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto",
    userName: "Vos",
    tamiDelayMs: 40,
    onSpeak(text) {
      spoken.push(text);
    },
    ask: async (prompt) => {
      seen.push(prompt);
      return "Está en src/login.js";
    },
  });

  await meeting.push({
    type: "captions",
    t: 1_000,
    items: [{ name: "Tú", text: "TAMI" }],
  });
  await meeting.push({
    type: "captions",
    t: 1_200,
    items: [{ name: "Tú", text: "TAMI, dónde está el login" }],
  });

  assert.equal(spoken.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 120));
  await meeting.finish();

  const live = fs.readFileSync(path.join(project, "meetings", "en-curso.md"), "utf8");
  assert.match(live, /\*\*TAMI:\*\* Está en src\/login\.js/);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /dónde está el login/);
  assert.deepEqual(spoken, ["Estoy en eso.", "Está en src/login.js"]);
});

test("cada TAMI nueva en la misma frase es otra consulta", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-otra-"));
  const project = path.join(root, "proyecto");
  fs.mkdirSync(project);
  const seen = [];
  const spoken = [];
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto",
    userName: "Vos",
    tamiDelayMs: 30,
    onSpeak(text) {
      spoken.push(text);
    },
    ask: async (prompt) => {
      seen.push(prompt);
      return "Hoy es lunes.";
    },
  });

  await meeting.push({
    type: "captions",
    baseline: true,
    t: 1_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(seen.length, 0);

  await meeting.push({
    type: "captions",
    t: 2_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó? TAMI, ¿qué día es hoy?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await meeting.finish();

  assert.equal(seen.length, 1);
  const asked = seen[0].split("Te dijeron:").pop();
  assert.match(asked, /qué día es hoy/);
  assert.doesNotMatch(asked, /a qué hora/);
  assert.equal(spoken.filter((line) => line === "Estoy en eso.").length, 1);
  assert.equal(spoken.at(-1), "Hoy es lunes.");
});

test("una frase que sigue creciendo consulta cada TAMI nueva", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-sigue-"));
  const project = path.join(root, "proyecto");
  fs.mkdirSync(project);
  const seen = [];
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto",
    userName: "Vos",
    tamiDelayMs: 30,
    ask: async (prompt) => {
      seen.push(prompt);
      return "ok";
    },
  });

  await meeting.push({
    type: "captions",
    t: 1_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await meeting.push({
    type: "captions",
    t: 2_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó? TAMI, ¿qué día es hoy?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await meeting.finish();

  assert.equal(seen.length, 2);
  assert.match(seen[0].split("Te dijeron:").pop(), /a qué hora/);
  const second = seen[1].split("Te dijeron:").pop();
  assert.match(second, /qué día es hoy/);
  assert.doesNotMatch(second, /a qué hora/);
});

test("si solo dice TAMI, la frase siguiente es la pregunta", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-decime-"));
  const project = path.join(root, "proyecto");
  fs.mkdirSync(project);
  const seen = [];
  const spoken = [];
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto",
    userName: "Vos",
    tamiDelayMs: 30,
    onSpeak(text) {
      spoken.push(text);
    },
    ask: async (prompt) => {
      seen.push(prompt);
      return "Hoy es lunes.";
    },
  });

  await meeting.push({
    type: "captions",
    t: 1_000,
    items: [{ name: "Tú", text: "TAMI" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(spoken, ["Sí, decime."]);
  assert.equal(seen.length, 0);

  await meeting.push({
    type: "captions",
    t: 2_000,
    items: [{ name: "Tú", text: "qué día es hoy" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await meeting.finish();

  assert.equal(seen.length, 1);
  assert.match(seen[0].split("Te dijeron:").pop(), /qué día es hoy/);
  assert.equal(spoken.at(-1), "Hoy es lunes.");
});

test("si llega otra pregunta, no dice la respuesta vieja", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-vieja-"));
  const project = path.join(root, "proyecto");
  fs.mkdirSync(project);
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const spoken = [];
  let calls = 0;
  const meeting = openMeeting({
    projectPath: project,
    projectName: "proyecto",
    userName: "Vos",
    tamiDelayMs: 30,
    onSpeak(text) {
      spoken.push(text);
    },
    ask: async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return "respuesta vieja";
      }
      return "respuesta nueva";
    },
  });

  await meeting.push({
    type: "captions",
    t: 1_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await meeting.push({
    type: "captions",
    t: 2_000,
    items: [{ name: "Tú", text: "TAMI, ¿a qué hora arrancó? TAMI, ¿qué día es hoy?" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await meeting.finish();

  assert.equal(spoken.includes("respuesta vieja"), false);
  assert.equal(spoken.at(-1), "respuesta nueva");
});

test("el servidor avisa para decir en voz alta lo que dice TAMI", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tami-voz-"));
  const project = path.join(root, "1-voz");
  fs.mkdirSync(project);
  const app = createServer({
    projectsRoot: root,
    config: { port: 0, userName: "Vos", extraProjects: [] },
    apiKey: "",
    tamiDelayMs: 30,
    ask: async () => "Está en src/login.js",
  });
  const port = await app.listen(0);
  try {
    const spoken = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no habló")), 2000);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", projectPath: project })));
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ready") {
          ws.send(JSON.stringify({
            type: "captions",
            t: Date.now(),
            items: [{ name: "Tú", text: "TAMI, dónde está el login" }],
          }));
        }
        if (msg.type === "speak") {
          spoken.push(msg.text);
          if (spoken.length === 2) ws.send(JSON.stringify({ type: "stop" }));
        }
        if (msg.type === "closed") {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
        if (msg.type === "error") reject(new Error(msg.message));
      });
      ws.on("error", reject);
    });
    assert.deepEqual(spoken, ["Estoy en eso.", "Está en src/login.js"]);
  } finally {
    await app.close();
  }
});

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { openMeeting } from "./meeting.js";
import { listProjects, samePath } from "./projects.js";
import { transcribeWav } from "./stt.js";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectsRoot = "";

function loadConfig() {
  const file = path.join(toolRoot, "config.json");
  if (!fs.existsSync(file)) {
    fs.copyFileSync(path.join(toolRoot, "config.example.json"), file);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = !origin
    || origin.startsWith("chrome-extension://")
    || origin.startsWith("http://127.0.0.1")
    || origin.startsWith("http://localhost");
  if (!allowed) return false;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("body");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createServer(options = {}) {
  const config = options.config || loadConfig();
  const projectsRoot = options.projectsRoot || config.projectsRoot || defaultProjectsRoot;
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY ?? config.groqApiKey ?? "";
  const transcribe = options.transcribe
    || ((wav) => transcribeWav(wav, apiKey, config.groqModel || "whisper-large-v3-turbo", config.language ?? "es"));
  const extra = [...(config.extraProjects || [])];
  let meeting = null;

  function projects() {
    return listProjects(projectsRoot, extra);
  }

  function status() {
    return {
      ok: true,
      stt: Boolean(options.transcribe || apiKey),
      meeting: meeting
        ? {
            id: meeting.id,
            projectName: meeting.projectName,
            lines: meeting.lines,
            frames: meeting.frames,
            lastLine: meeting.lastLine,
            error: meeting.error,
          }
        : null,
    };
  }

  const server = http.createServer(async (req, res) => {
    if (!applyCors(req, res)) {
      sendJson(res, 403, { error: "origen" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        sendJson(res, 200, status());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/projects") {
        sendJson(res, 200, { projects: projects(), stt: status().stt, userName: config.userName || "Vos" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/stop") {
        await meeting?.finish();
        meeting = null;
        sendJson(res, 200, status());
        return;
      }
      sendJson(res, 404, { error: "no está" });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "error" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/live", maxPayload: 8_000_000 });

  wss.on("connection", (socket, req) => {
    const origin = req.headers.origin || "";
    if (origin && !origin.startsWith("chrome-extension://") && !origin.startsWith("http://127.0.0.1") && !origin.startsWith("http://localhost")) {
      socket.close(4003, "origen");
      return;
    }

    const send = (body) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(body));
    };

    const pumpCaptures = () => {
      if (!meeting) return;
      for (const capture of meeting.takeCaptures()) send({ type: "capture", ...capture });
    };

    const onMessage = async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (msg.type === "hello") {
          const project = projects().find((item) => samePath(item.path, msg.projectPath || ""));
          if (!project) {
            send({ type: "error", message: "Esa carpeta no está entre los proyectos" });
            return;
          }
          await meeting?.finish();
          meeting = openMeeting({
            projectPath: project.path,
            projectName: project.name,
            userName: config.userName || "Vos",
            transcribe,
            ask: options.ask,
            tamiDelayMs: options.tamiDelayMs,
            onSpeak(text) {
              send({ type: "speak", text });
            },
          });
          send({ type: "ready", meetingId: meeting.id, folder: `meetings/${meeting.id}` });
          return;
        }
        if (!meeting) return;
        await meeting.push(msg);
        pumpCaptures();
        if (msg.type === "stop") {
          await meeting.finish();
          meeting = null;
          send({ type: "closed" });
        }
      } catch (error) {
        send({ type: "error", message: error.message || "error" });
      }
    };

    let chain = Promise.resolve();
    socket.on("message", (raw) => {
      chain = chain.then(() => onMessage(raw)).catch((error) => {
        send({ type: "error", message: error.message || "error" });
      });
    });

    socket.on("close", () => {
      const timer = setTimeout(async () => {
        const stillOpen = [...wss.clients].some((client) => client.readyState === client.OPEN);
        if (!stillOpen && meeting) {
          await meeting.finish();
          meeting = null;
        }
      }, 4000);
      timer.unref();
    });
  });

  return {
    server,
    async listen(port = config.port || 3939) {
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      return server.address().port;
    },
    close() {
      return new Promise((resolve) => {
        for (const client of wss.clients) client.close();
        wss.close();
        server.close(resolve);
      });
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createServer();
  const port = await app.listen();
  console.log(`Reuniones en http://127.0.0.1:${port}`);
}

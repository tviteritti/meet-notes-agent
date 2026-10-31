import { meetCall } from "./meet-url.js";

let offscreenPort = null;
let running = false;
let lastError = "";
let voiceReady;

function spanishVoice() {
  voiceReady ||= chrome.tts.getVoices().then((voices) => {
    const spanish = (voices || []).filter((voice) => /^es\b/i.test(voice.lang || ""));
    const pick = spanish.find((voice) => /es-MX|sabina/i.test(`${voice.lang} ${voice.voiceName}`))
      || spanish[0];
    return pick?.voiceName || "";
  }).catch(() => "");
  return voiceReady;
}

function forSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function speak(text) {
  const line = forSpeech(text);
  if (!line) return;
  const voiceName = await spanishVoice();
  const options = { lang: "es-MX", rate: 1.05, enqueue: true };
  if (voiceName) options.voiceName = voiceName;
  chrome.tts.speak(line, options, () => {
    if (!chrome.runtime.lastError || !options.voiceName) return;
    delete options.voiceName;
    chrome.tts.speak(line, options);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "offscreen") return;
  offscreenPort = port;
  port.onMessage.addListener((msg) => {
    if (msg?.type === "speak") void speak(msg.text);
  });
  port.onDisconnect.addListener(() => {
    if (offscreenPort === port) offscreenPort = null;
  });
});

async function ensureOffscreen() {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capturar el micrófono y el audio de Meet, y seguir escuchando la reunión",
    });
  }
  const start = Date.now();
  while (!offscreenPort) {
    if (Date.now() - start > 4000) throw new Error("No arrancó la captura de audio");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function pickCall(tabs) {
  const calls = (tabs || []).filter((tab) => meetCall(tab.url || ""));
  return calls.find((tab) => tab.active) || calls[0] || null;
}

function waitForStart(token) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      offscreenPort?.onMessage.removeListener(onMessage);
      reject(new Error("La captura no respondió"));
    }, 15000);
    function onMessage(msg) {
      if (msg.token !== token) return;
      if (msg.type !== "started" && msg.type !== "capture-error") return;
      clearTimeout(timer);
      offscreenPort?.onMessage.removeListener(onMessage);
      if (msg.type === "capture-error") reject(new Error(msg.message));
      else resolve();
    }
    offscreenPort.onMessage.addListener(onMessage);
  });
}

async function startWithStream(projectPath, tab, streamId) {
  lastError = "";
  await ensureOffscreen();
  const token = crypto.randomUUID();
  const pending = waitForStart(token);
  offscreenPort.postMessage({
    type: "start-capture",
    token,
    streamId,
    projectPath,
    server: "ws://127.0.0.1:3939/live",
  });
  await pending;
  try {
    await arm(tab.id);
  } catch {
    lastError = "No pude leer los subtítulos. Recargá la pestaña de Meet y tocá Iniciar otra vez.";
  }
  running = true;
}

async function arm(tabId) {
  const watch = () => chrome.tabs.sendMessage(tabId, { type: "watch", on: true });
  try {
    await watch();
    return;
  } catch {}
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await watch();
}

function explain(message) {
  if (/active stream/i.test(message || "")) {
    return "La captura anterior de Meet sigue abierta. Tocá Permitir y empezar otra vez.";
  }
  return message;
}

function waitForStopped(token) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      offscreenPort?.onMessage.removeListener(onMessage);
      resolve();
    }, 2000);
    function onMessage(msg) {
      if (msg.type !== "stopped" || msg.token !== token) return;
      clearTimeout(timer);
      offscreenPort?.onMessage.removeListener(onMessage);
      resolve();
    }
    offscreenPort.onMessage.addListener(onMessage);
  });
}

async function stop() {
  running = false;
  try { chrome.tts.stop(); } catch {}
  try {
    const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "watch", on: false }).catch(() => {})));
  } catch {}
  if (await chrome.offscreen.hasDocument()) {
    const start = Date.now();
    while (!offscreenPort && Date.now() - start < 1500) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!offscreenPort) return;
  const token = crypto.randomUUID();
  const done = waitForStopped(token);
  offscreenPort.postMessage({ type: "stop-capture", token });
  await done;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "get-state") {
    sendResponse({ running, error: lastError });
    return;
  }
  if (msg?.type === "start") {
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
      if (chrome.runtime.lastError) {
        lastError = chrome.runtime.lastError.message || "Chrome no dejó ver las pestañas";
        sendResponse({ ok: false, error: lastError });
        return;
      }
      const list = tabs || [];
      const tab = pickCall(list);
      if (!tab) {
        lastError = list.length
          ? "Esa pestaña es el inicio de Meet, no la llamada. Entrá a la reunión y volvé a tocar Iniciar."
          : "No veo Meet en este Chrome. Abrila en esta misma ventana, no en otro perfil.";
        sendResponse({ ok: false, error: lastError });
        return;
      }
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          lastError = explain(chrome.runtime.lastError?.message || "Chrome no dejó capturar la pestaña");
          sendResponse({ ok: false, error: lastError });
          return;
        }
        startWithStream(msg.projectPath, tab, streamId)
          .then(() => sendResponse({ ok: true, error: lastError }))
          .catch((error) => {
            running = false;
            lastError = error.message || "No se pudo iniciar";
            sendResponse({ ok: false, error: lastError });
          });
      });
    });
    return true;
  }
  if (msg?.type === "stop") {
    stop()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

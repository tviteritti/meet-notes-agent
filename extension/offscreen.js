import { Resampler, createPhraseCapture, pcmToBase64 } from "./audio.js";

const video = document.querySelector("#tab");
const canvas = document.querySelector("#frame");
const SERVER = "ws://127.0.0.1:3939/live";

let port;
let ws = null;
let outbound = [];
let ready = false;
let token = "";
let projectPath = "";
let taps = [];
let streams = [];

function connect() {
  port = chrome.runtime.connect({ name: "offscreen" });
  port.onMessage.addListener(onControl);
  port.onDisconnect.addListener(() => setTimeout(connect, 300));
}

function send(obj) {
  outbound.push(JSON.stringify(obj));
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  while (outbound.length) ws.send(outbound.shift());
}

function grabFrame() {
  if (!video.videoWidth) return "";
  const scale = Math.min(1, 1280 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.65).split(",")[1];
}

async function tap(stream, track, audible) {
  const ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule(chrome.runtime.getURL("worklet.js"));
  const source = ctx.createMediaStreamSource(stream);
  if (audible) source.connect(ctx.destination);
  const node = new AudioWorkletNode(ctx, "capture-processor");
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  const resampler = new Resampler(ctx.sampleRate);
  const phrases = createPhraseCapture((pcm, t0, t1) => {
    send({ type: "audio", track, t0, t1, wavBase64: pcmToBase64(pcm) });
  });
  node.port.onmessage = (event) => {
    const pcm = resampler.process(event.data);
    if (pcm.length) phrases.push(pcm);
  };
  taps.push({ ctx, phrases });
}

async function cleanup() {
  for (const item of taps) {
    item.phrases.flush();
    await item.ctx.close().catch(() => {});
  }
  taps = [];
  for (const stream of streams) stream.getTracks().forEach((track) => track.stop());
  streams = [];
  video.srcObject = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  outbound = [];
  ready = false;
}

async function startCapture(msg) {
  await cleanup();
  token = msg.token;
  projectPath = msg.projectPath;
  const source = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: msg.streamId,
  };
  let tabStream;
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: source },
      video: {
        mandatory: {
          ...source,
          maxWidth: 1280,
          maxHeight: 720,
          maxFrameRate: 5,
        },
      },
    });
  } catch {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: source },
    });
  }
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  streams = [tabStream, micStream];
  for (const track of [...tabStream.getTracks(), ...micStream.getTracks()]) {
    track.onended = () => {
      if (!ready) return;
      port.postMessage({ type: "capture-error", token, message: "Se cortó el audio de Meet. Volvé a iniciar." });
    };
  }
  const videoTracks = tabStream.getVideoTracks();
  if (videoTracks.length) {
    video.srcObject = new MediaStream(videoTracks);
    video.muted = true;
    await video.play().catch(() => {});
  }
  await tap(tabStream, "tab", true);
  await tap(micStream, "mic", false);

  ws = new WebSocket(SERVER);
  ws.onopen = () => {
    outbound.unshift(JSON.stringify({ type: "hello", projectPath }));
    while (outbound.length && ws.readyState === WebSocket.OPEN) ws.send(outbound.shift());
  };
  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "ready") {
      ready = true;
      port.postMessage({ type: "started", token });
      port.postMessage({ type: "speak", text: "Estoy escuchando." });
    }
    if (data.type === "error" && !ready) {
      port.postMessage({ type: "capture-error", token, message: data.message });
      cleanup();
    }
    if (data.type === "speak" && data.text) port.postMessage({ type: "speak", text: data.text });
    if (data.type === "capture") {
      setTimeout(() => {
        const jpegBase64 = grabFrame();
        if (jpegBase64) send({ type: "frame", t: Date.now(), reason: data.reason, jpegBase64 });
      }, data.delayMs || 0);
    }
  };
  ws.onerror = () => {
    if (ready) return;
    port.postMessage({
      type: "capture-error",
      token,
      message: "No llega el servidor. En 5-reuniones corré npm start.",
    });
  };
}

async function onControl(msg) {
  if (msg.type === "start-capture") {
    try {
      await startCapture(msg);
    } catch (error) {
      port.postMessage({
        type: "capture-error",
        token: msg.token,
        message: error.message || "No se pudo capturar Meet",
      });
      await cleanup();
    }
  }
  if (msg.type === "stop-capture") {
    for (const item of taps) item.phrases.flush();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
    await cleanup();
    port.postMessage({ type: "stopped", token: msg.token });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "meet-event") send(msg.event);
});

connect();

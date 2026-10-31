const SERVER = "http://127.0.0.1:3939";
const select = document.querySelector("#project");
const toggle = document.querySelector("#toggle");
const status = document.querySelector("#status");
let recording = false;
let micGranted = false;

function show(text, kind) {
  status.textContent = text || "";
  status.className = kind || "";
}

async function loadProjects() {
  const saved = await chrome.storage.local.get("projectPath");
  let data;
  try {
    const response = await fetch(`${SERVER}/api/projects`);
    data = await response.json();
  } catch {
    select.innerHTML = "";
    show("No llega el servidor. En 5-reuniones corré npm start.", "err");
    return;
  }
  select.innerHTML = "";
  for (const project of data.projects) {
    const option = document.createElement("option");
    option.value = project.path;
    option.textContent = project.folder;
    select.append(option);
  }
  if (saved.projectPath) select.value = saved.projectPath;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "get-state" });
  let live = null;
  try {
    const response = await fetch(`${SERVER}/api/status`);
    live = (await response.json()).meeting;
  } catch {
    live = null;
  }
  recording = Boolean(state?.running || live);
  toggle.textContent = recording ? "Detener" : "Iniciar";
  toggle.classList.toggle("stop", recording);
  select.disabled = recording;
  if (state?.error) show(state.error, recording ? "" : "err");
  else if (live) show(`${live.lines} líneas · ${live.lastLine || "esperando voz"}`, "ok");
}

function openMicPage(projectPath) {
  chrome.tabs.create({
    url: `${chrome.runtime.getURL("mic.html")}?project=${encodeURIComponent(projectPath)}`,
  });
}

async function watchMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    micGranted = status.state === "granted";
    status.onchange = () => {
      micGranted = status.state === "granted";
    };
  } catch {
    micGranted = false;
  }
}

toggle.addEventListener("click", () => {
  toggle.disabled = true;
  if (recording) {
    void (async () => {
      try {
        await chrome.runtime.sendMessage({ type: "stop" });
        await fetch(`${SERVER}/api/stop`, { method: "POST" });
        show("Reunión cerrada. Quedó en meetings/ del proyecto.", "ok");
      } catch (error) {
        show(error.message || "No se pudo detener", "err");
      } finally {
        toggle.disabled = false;
        refresh();
      }
    })();
    return;
  }

  const projectPath = select.value;
  if (!projectPath) {
    show("No hay carpetas en projectsRoot. Revisá config.json.", "err");
    toggle.disabled = false;
    return;
  }

  if (!micGranted) {
    chrome.runtime.sendMessage({ type: "stop" }).catch(() => {});
    openMicPage(projectPath);
    show("Aceptá el micrófono en la pestaña que se abrió y tocá Permitir y empezar.", "");
    toggle.disabled = false;
    return;
  }

  const startPromise = chrome.runtime.sendMessage({ type: "start", projectPath });
  void (async () => {
    try {
      const result = await startPromise;
      if (!result?.ok) throw new Error(result?.error || "No se pudo iniciar");
      await chrome.storage.local.set({ projectPath });
      show(result.error || "Grabando. Preguntale a Cursor con el proyecto abierto.", "ok");
    } catch (error) {
      chrome.runtime.sendMessage({ type: "stop" }).catch(() => {});
      show(error.message || "No se pudo iniciar", "err");
    } finally {
      toggle.disabled = false;
      refresh();
    }
  })();
});

watchMicPermission();
loadProjects().then(refresh);

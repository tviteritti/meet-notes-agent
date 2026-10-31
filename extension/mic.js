const status = document.querySelector("#status");
const button = document.querySelector("#allow");
const projectPath = new URLSearchParams(location.search).get("project") || "";

status.textContent = "Cerrando la captura anterior…";
chrome.runtime.sendMessage({ type: "stop" }).finally(() => {
  button.disabled = false;
  status.textContent = "";
});

button.addEventListener("click", () => {
  button.disabled = true;
  status.textContent = "Pidiendo micrófono…";
  status.className = "";
  const micPromise = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const startPromise = chrome.runtime.sendMessage({ type: "start", projectPath });
  void (async () => {
    try {
      const stream = await micPromise;
      stream.getTracks().forEach((track) => track.stop());
      const result = await startPromise;
      if (!result?.ok) throw new Error(result?.error || "No se pudo iniciar");
      await chrome.storage.local.set({ projectPath });
      status.textContent = "Grabando. Ya podés cerrar esta pestaña.";
      status.className = "ok";
    } catch (error) {
      await chrome.runtime.sendMessage({ type: "stop" }).catch(() => {});
      button.disabled = false;
      status.textContent = error.message || "No se pudo tomar el micrófono";
      status.className = "err";
    }
  })();
});

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function strip(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
}

export function askCursor({ workspace, prompt, command }) {
  const script = command || path.join(process.env.LOCALAPPDATA || "", "cursor-agent", "cursor-agent.ps1");
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const meetings = path.join(workspace, "meetings");
  const questionFile = path.join(meetings, ".tami-pregunta.txt");
  fs.mkdirSync(meetings, { recursive: true });
  fs.writeFileSync(questionFile, prompt, "utf8");
  const instruction = "Leé meetings/.tami-pregunta.txt y respondé esa consulta en español, corto, para decirlo en voz alta. No edites archivos.";

  return new Promise((resolve, reject) => {
    const child = spawn(powershell, [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-p",
      "--mode", "ask",
      "--trust",
      "--output-format", "text",
      "--workspace", workspace,
      instruction,
    ], {
      cwd: workspace,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("TAMI tardó demasiado"));
    }, 120000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 100000) out = out.slice(-100000);
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(questionFile, { force: true });
      const text = strip(out);
      if (text) {
        resolve(text);
        return;
      }
      reject(new Error(strip(err).slice(0, 300) || `Cursor CLI salió con código ${code}`));
    });
  });
}

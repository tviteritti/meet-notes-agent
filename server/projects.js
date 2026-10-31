import fs from "node:fs";
import path from "node:path";

export function projectLabel(folderName) {
  return folderName.replace(/^\d+-/, "").replace(/-/g, " ");
}

export function listProjects(root, extra = []) {
  const found = [];
  if (root && fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      if (name === "5-reuniones" || name.startsWith(".")) continue;
      const full = path.join(root, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      found.push({ name: projectLabel(name), folder: name, path: path.resolve(full) });
    }
  }
  for (const item of extra) {
    const full = path.resolve(item);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
    const folder = path.basename(full);
    found.push({ name: projectLabel(folder), folder, path: full });
  }
  const unique = new Map();
  for (const project of found) unique.set(project.path.toLowerCase(), project);
  return [...unique.values()].sort((a, b) => a.folder.localeCompare(b.folder, "es"));
}

export function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

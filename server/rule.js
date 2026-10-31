import fs from "node:fs";
import path from "node:path";

const RULE = `---
description: Transcripciones de reuniones guardadas en este proyecto
alwaysApply: true
---

Las reuniones están en \`meetings/\`. Quien habla desde el micrófono figura con su nombre (o **Vos** si Meet no lo dio). El resto son los otros participantes.

- Si \`meetings/en-curso.md\` tiene \`estado: abierta\`, es la reunión de ahora. Leé ese archivo antes de responder sobre la reunión. Se actualiza solo, con unos segundos de demora.
- Cada reunión queda en \`meetings/<fecha>/notas.md\`, el detalle en \`transcript.jsonl\` y las capturas en \`frames/\`. El índice es \`meetings/index.jsonl\`.
- Si piden feedback del desempeño, usá solo esas notas, citá frases de la persona del micrófono y decí qué cambiar. No inventes lo que no está escrito.
- Si en la reunión dicen TAMI, la reacción y la respuesta también quedan en esa transcripción.
`;

export function ensureRule(projectPath) {
  const file = path.join(projectPath, ".cursor", "rules", "reuniones.mdc");
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, RULE, "utf8");
  return true;
}

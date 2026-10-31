function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function isUserTurn(segment, meeting) {
  const speaker = String(segment.speaker || "").trim().toLowerCase();
  if (speaker === "tú" || speaker === "tu" || speaker === "you" || speaker === "vos") return true;
  if (meeting.selfName && speaker === String(meeting.selfName).trim().toLowerCase()) return true;
  if (meeting.userName && speaker === String(meeting.userName).trim().toLowerCase()) return true;
  return false;
}

export function countTurns(meeting) {
  const talk = meeting.segments.filter((segment) => segment.track !== "tami");
  const mine = talk.filter((segment) => isUserTurn(segment, meeting)).length;
  return { mine, others: talk.length - mine };
}

export function renderNotes(meeting, { closed, imagePrefix }) {
  const { mine, others } = countTurns(meeting);
  const lines = [
    "---",
    `estado: ${closed ? "cerrada" : "abierta"}`,
    `inicio: ${quote(new Date(meeting.startedAt).toISOString())}`,
    `carpeta: ${quote(`meetings/${meeting.id}`)}`,
    `proyecto: ${quote(meeting.projectName)}`,
    `intervenciones_vos: ${mine}`,
    `intervenciones_otros: ${others}`,
    `capturas: ${meeting.frames.length}`,
  ];
  if (closed && meeting.endedAt) lines.push(`fin: ${quote(new Date(meeting.endedAt).toISOString())}`);
  lines.push("---", "", `# Reunión ${meeting.id}`, "", "## Transcripción", "");

  if (!meeting.segments.length) lines.push("_Todavía no hay voz._", "");
  else {
    for (const segment of meeting.segments) {
      lines.push(`[${clock(segment.t0)}] **${segment.speaker}:** ${segment.text}`, "");
    }
  }

  lines.push("## Pantalla", "");
  if (!meeting.frames.length) lines.push("_Sin capturas._", "");
  else {
    for (const frame of meeting.frames) {
      const file = `${imagePrefix}${frame.file}`;
      lines.push(`- [${clock(frame.t)}] ${frame.reason}. Archivo: \`${file}\``, "", `![${frame.reason}](${file})`, "");
    }
  }

  if (closed) {
    const questions = meeting.segments.filter((segment) => isUserTurn(segment, meeting) && segment.text.includes("?")).length;
    lines.push(
      "## Para el feedback",
      "",
      `- Intervenciones tuyas: ${mine}`,
      `- Intervenciones de los demás: ${others}`,
      `- Preguntas tuyas: ${questions}`,
      "- En Cursor, preguntá cómo te desempeñaste en esta reunión y qué cambiar. La respuesta tiene que salir de esta transcripción.",
      "",
    );
  }
  return lines.join("\n");
}

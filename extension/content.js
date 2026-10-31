let watching = false;
let timer = 0;
let observer = null;
let lastCaption = "";
let lastSpeaker = "";
let lastPresenter = "";
let selfName = "";
let captionsSeen = false;
let captionTries = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "watch") return;
  if (msg.on) start();
  else stop();
});

function send(event) {
  chrome.runtime.sendMessage({ type: "meet-event", event }).catch(() => {});
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function start() {
  stop();
  watching = true;
  captionsSeen = false;
  captionTries = 0;
  lastCaption = "";
  lastSpeaker = "";
  lastPresenter = "";
  enableCaptions();
  const existing = collectCaptions();
  if (existing.length) {
    lastCaption = JSON.stringify(existing);
    send({ type: "captions", t: Date.now(), baseline: true, items: existing });
  }
  attachCaptions();
  timer = setInterval(scan, 400);
  scan();
}

function stop() {
  watching = false;
  clearInterval(timer);
  observer?.disconnect();
  observer = null;
}

function enableCaptions() {
  for (const button of document.querySelectorAll("button, [role='button']")) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.innerText || ""}`;
    if (/desactivar|turn off|ocultar subt/i.test(label)) continue;
    if (/activar subt[ií]tulos|turn on captions|show captions|subt[ií]tulos desactivados/i.test(label)) {
      button.click();
      return;
    }
  }
}

function parseRow(row) {
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  if (rect.height > 150 || rect.width < 40) return null;
  let speaker = clean(row.querySelector("div.KcIKyf, div.zs7s8d, span[jsname='YSxPC']")?.innerText || "");
  let text = clean(row.querySelector("div.bh44bd, span[jsname='tgaKEf'], div.iTTPOb")?.innerText || "");
  if (!speaker) {
    speaker = clean(row.parentElement?.querySelector("div.KcIKyf, div.zs7s8d, span[jsname='YSxPC']")?.innerText || "");
  }
  if (!text) {
    const lines = (row.innerText || "").split("\n").map(clean).filter((line) => line.length > 1);
    if (lines.length >= 2 && lines[0].length <= 40) {
      speaker = speaker || lines[0];
      text = lines.slice(1).join(" ");
    } else if (lines.length === 1) text = lines[0];
  }
  if (speaker && text.startsWith(speaker)) text = clean(text.slice(speaker.length));
  if (!text || text.length < 2 || text.length > 400) return null;
  return { name: speaker, text };
}

function collectCaptions() {
  const roots = [...document.querySelectorAll('[role="region"][aria-label*="aption" i], [role="region"][aria-label*="ubtítulo" i], [role="region"][aria-label*="ubtitulo" i], .a4cQT')];
  const textNodes = [...document.querySelectorAll("div[jsname='tgaKEf'], div.bh44bd, div.iTTPOb")];
  if (!roots.length && textNodes[0]) {
    let parent = textNodes[0].parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const count = parent.querySelectorAll("div[jsname='tgaKEf'], div.bh44bd, div.iTTPOb").length;
      if (count >= 1 && parent.getBoundingClientRect().height < window.innerHeight * 0.6) roots.push(parent);
      parent = parent.parentElement;
    }
  }
  const rows = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    const key = `${item.name}|${item.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(item);
  };
  for (const root of roots) {
    const found = [...root.querySelectorAll("div[jsname='dsyhDe'], div.CNusmb, div.TBMuR, div.iOzk7")];
    for (const row of found.length ? found : [root]) push(parseRow(row));
  }
  if (!rows.length) {
    for (const node of textNodes) push(parseRow(node.parentElement || node));
  }
  return rows.filter((item, index) => !rows.some((other, otherIndex) => otherIndex !== index && other.name === item.name && other.text.includes(item.text) && other.text.length > item.text.length));
}

function publishCaptions() {
  if (!watching) return;
  const items = collectCaptions();
  const key = JSON.stringify(items);
  if (!items.length || key === lastCaption) return;
  lastCaption = key;
  captionsSeen = true;
  send({ type: "captions", t: Date.now(), items });
}

function attachCaptions() {
  const root = document.querySelector('[role="region"][aria-label*="aption" i], [role="region"][aria-label*="ubtítulo" i], [role="region"][aria-label*="ubtitulo" i], .a4cQT')
    || document.querySelector("div[jsname='tgaKEf'], div.bh44bd, div.iTTPOb")?.parentElement;
  if (!root) {
    if (watching && captionTries++ < 20) setTimeout(attachCaptions, 1000);
    return;
  }
  observer?.disconnect();
  observer = new MutationObserver(() => publishCaptions());
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  publishCaptions();
}

function findSelf() {
  const marked = document.querySelector("[data-self-name]");
  if (marked) {
    const name = clean(marked.getAttribute("data-self-name") || marked.textContent).replace(/\(t[uú]\)|\(you\)/gi, "");
    if (name) return clean(name);
  }
  for (const el of document.querySelectorAll("[data-participant-id] [aria-label], [aria-label*='(']")) {
    const label = el.getAttribute("aria-label") || "";
    if (label.length > 80 || !/\(t[uú]\)|\(you\)/i.test(label)) continue;
    return clean(label.replace(/\(t[uú]\)|\(you\)/gi, "").split(",")[0]);
  }
  return "";
}

function findPresenter() {
  for (const el of document.querySelectorAll("[aria-label]")) {
    const label = el.getAttribute("aria-label") || "";
    const match = label.match(/^(.{2,60}?)\s+(?:est[aá] presentando|is presenting)\b/i);
    if (match) return clean(match[1]);
  }
  return "";
}

function dominantSpeaker() {
  const tiles = [...document.querySelectorAll("[data-participant-id]")];
  const ranked = tiles
    .map((tile) => {
      const rect = tile.getBoundingClientRect();
      const aria = tile.getAttribute("aria-label") || "";
      const name = clean(aria.split(",")[0].split("(")[0]);
      return { name, area: rect.width * rect.height };
    })
    .filter((tile) => tile.name && tile.area > 8000)
    .sort((a, b) => b.area - a.area);
  if (!ranked.length) return "";
  if (ranked.length > 1 && ranked[0].area < ranked[1].area * 1.4) return "";
  return ranked[0].name;
}

function scan() {
  if (!watching) return;
  const self = findSelf();
  if (self && self !== selfName) {
    selfName = self;
    send({ type: "self", name: self, t: Date.now() });
  }
  const presenter = findPresenter();
  if (presenter !== lastPresenter) {
    lastPresenter = presenter;
    if (presenter) send({ type: "presenting", name: presenter, active: true, t: Date.now() });
  }
  publishCaptions();
  if (captionsSeen) return;
  const speaker = dominantSpeaker();
  if (!speaker || speaker === lastSpeaker) return;
  lastSpeaker = speaker;
  send({ type: "speaker", name: speaker, t: Date.now() });
}

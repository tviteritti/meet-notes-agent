export function meetCall(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname !== "meet.google.com") return false;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/landing" || path === "/about") return false;
  if (path.startsWith("/_/")) return false;
  return true;
}

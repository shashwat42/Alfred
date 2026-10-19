/** Preserve block boundaries, including a plain first line followed by a div. */
export function notePlainText(content: string): string {
  const text = content.replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
    .replace(/([^\n])<(?:p|div|li|h[1-6]|blockquote|pre|tr)(?:\s[^>]*)?>/gi, "$1\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  if (typeof document !== "undefined") {
    const decoder = document.createElement("textarea"); decoder.innerHTML = text;
    return decoder.value.replace(/\u00a0/g, " ").trim();
  }
  const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, entity => entities[entity]!).trim();
}

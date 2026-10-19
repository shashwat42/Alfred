/** Device workspace format. This module has no server or database dependencies. */
export type WorkspaceRecord = { _id: string; createdAt: string; updatedAt: string; [key: string]: unknown };
export interface WorkspaceData { tasks: WorkspaceRecord[]; notes: WorkspaceRecord[]; schedule: WorkspaceRecord[] }
export const emptyWorkspace = (): WorkspaceData => ({ tasks: [], notes: [], schedule: [] });
export function newRecordId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function mergeWorkspace(local: WorkspaceData, remote: WorkspaceData): WorkspaceData {
  const result = emptyWorkspace();
  for (const kind of ["tasks", "notes", "schedule"] as const) {
    const records = new Map(remote[kind].map(row => [row._id, row]));
    for (const row of local[kind]) {
      const previous = records.get(row._id);
      if (!previous || row.updatedAt > previous.updatedAt) records.set(row._id, row);
    }
    result[kind] = [...records.values()];
  }
  return result;
}

export function workspaceRequest(data: WorkspaceData, url: URL, method: string, payload: Record<string, unknown> = {}): { status: number; body?: unknown } {
  const [, , resource, id, action] = url.pathname.split("/");
  const kind = resource === "tasks" ? "tasks" : resource === "notes" ? "notes" : resource === "schedule" ? "schedule" : null;
  if (!kind) return { status: 404, body: { error: "Unknown local workspace endpoint." } };
  let rows = data[kind];
  const fail = (error: string, status = 400) => ({ status, body: { error } });
  const date = url.searchParams.get("date");
  if (method === "GET") {
    if (kind === "schedule" && date) rows = rows.filter(row => row.date === date);
    if (kind === "notes") rows = rows.filter(row => String(row.title ?? "").trim() || String(row.content ?? "").trim());
    const fields = kind === "schedule" ? ["time"] : kind === "notes" && id === "recent" ? ["lastOpenedAt", "updatedAt"] : [kind === "notes" ? "updatedAt" : "createdAt"];
    rows = [...rows].sort((a, b) => {
      for (const field of fields) { const order = String(a[field] ?? "").localeCompare(String(b[field] ?? "")); if (order) return kind === "schedule" ? order : -order; }
      return 0;
    });
    if (id === "recent") rows = rows.slice(0, Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 4))));
    return { status: 200, body: rows };
  }
  if (method === "DELETE" && (!id || id === "clear-all")) {
    if (kind === "notes") return fail("Choose a note to delete.");
    if (kind === "schedule" && !id && !date) return fail("Choose a date to clear.");
    const kept = kind === "schedule" && date && id !== "clear-all" ? rows.filter(row => row.date !== date) : [];
    data[kind] = kept;
    return { status: 200, body: { deletedCount: rows.length - kept.length, ...(date ? { date } : {}) } };
  }
  const existing = rows.find(row => row._id === id);
  if (id && !existing) return fail("Item not found.", 404);
  if (method === "DELETE") { data[kind] = rows.filter(row => row._id !== id); return { status: 200, body: existing }; }
  const fields = kind === "schedule" && payload.schedule && typeof payload.schedule === "object" ? payload.schedule as Record<string, unknown> : payload;
  const allowed = kind === "tasks" ? ["task", "completed", "priority"] : kind === "notes" ? ["title", "content"] : ["time", "topic", "date"];
  if (Object.keys(fields).some(key => !allowed.includes(key))) return fail("Invalid workspace fields.");
  const now = new Date().toISOString();
  const row: WorkspaceRecord = existing ? { ...existing } : { _id: newRecordId(), createdAt: now, updatedAt: now };
  Object.assign(row, fields, { updatedAt: now });
  if (kind === "tasks") {
    row.task = String(row.task ?? "").trim(); row.priority ??= "normal"; row.completed ??= false;
    if (action === "complete") row.completed = typeof fields.completed === "boolean" ? fields.completed : !existing?.completed;
    if (!row.task || String(row.task).length > 500 || typeof row.completed !== "boolean" || !["urgent", "high", "medium", "normal", "low"].includes(String(row.priority))) return fail("Invalid task.");
  } else if (kind === "notes") {
    row.title = String(row.title ?? "").trim(); row.content = String(row.content ?? ""); row.lastOpenedAt = now;
    if ((!row.title && !row.content) || String(row.title).length > 200 || String(row.content).length > 50000) return fail("Notes need a title or content within the size limit.");
  } else {
    row.topic = String(row.topic ?? "").trim(); row.time = String(row.time ?? "").trim();
    const parsedDate = new Date(`${row.date}T00:00:00Z`);
    if (!row.topic || String(row.topic).length > 200 || !row.time || String(row.time).length > 50 || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== row.date) return fail("Invalid schedule date, time or topic.");
  }
  if (existing) rows[rows.indexOf(existing)] = row; else rows.push(row);
  return { status: existing ? 200 : 201, body: kind === "schedule" && !existing ? { schedule: row } : row };
}

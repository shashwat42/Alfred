import { z } from "zod";
import { validProfileName, validProfilePicture } from "./profile.ts";
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).refine(validProfileName).optional(),
  picture: z.union([z.string(), z.null()]).refine(validProfilePicture, "Choose a PNG, JPEG or WebP photo, or a secure HTTPS image.").optional(),
  updatedAt: z.iso.datetime(),
}).strict();

const base = { _id: z.string().regex(/^[a-f0-9]{24}$/), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
export const workspaceSchema = z.object({
  tasks: z.array(z.object({ ...base, task: z.string().trim().min(1).max(500), completed: z.boolean(), priority: z.enum(["urgent", "high", "medium", "normal", "low"]) }).strict()).max(10000),
  notes: z.array(z.object({ ...base, title: z.string().max(200), content: z.string().max(50000), lastOpenedAt: z.iso.datetime() }).strict()).max(10000),
  schedule: z.array(z.object({ ...base, time: z.string().min(1).max(50), topic: z.string().min(1).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }) }).strict()).max(10000),
}).strict().refine(data => Object.values(data).every(rows => new Set(rows.map(row => row._id)).size === rows.length), "Duplicate workspace IDs.");

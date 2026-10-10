import type { Request, Response } from "express";
import { requireAccountId } from "../../utils/requireAccountId.ts";
import {
    createNote,
    deleteNote as removeNote,
    getNotes,
    getRecentNotes,
    touchNote,
    updateNote as editNote,
} from "./service.ts";

export async function listNotes(req: Request, res: Response): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const notes = await getNotes(accountId);
        res.json(notes);
    } catch (err) {
        console.error("Error listing notes:", err);
        res.status(500).json({ error: "Failed to retrieve notes" });
    }
}

export async function getRecentNotesHandler(req: Request, res: Response): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 4;
        const notes = await getRecentNotes(accountId, isNaN(limit) ? 4 : limit);
        res.json(notes);
    } catch (err) {
        console.error("Error getting recent notes:", err);
        res.status(500).json({ error: "Failed to retrieve recent notes" });
    }
}

export async function createNoteHandler(
    req: Request<Record<string, never>, unknown, { title?: string; content?: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const title = typeof req.body?.title === "string" ? req.body.title : "";
        const content = typeof req.body?.content === "string" ? req.body.content : "";

        if (!title.trim() && !content.trim()) {
            res.status(400).json({ error: "Note cannot be empty" });
            return;
        }

        const note = await createNote(accountId, title, content);
        res.status(201).json(note);
    } catch (err) {
        console.error("Error creating note:", err);
        res.status(500).json({ error: "Failed to create note" });
    }
}

export async function updateNoteHandler(
    req: Request<{ id: string }, unknown, { title?: string; content?: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const { title, content } = req.body ?? {};

        const updates: { title?: string; content?: string } = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) updates.content = content;

        const updated = await editNote(accountId, id, updates);
        if (!updated) {
            res.status(404).json({ error: "Note not found" });
            return;
        }

        res.json(updated);
    } catch (err) {
        console.error("Error updating note:", err);
        res.status(500).json({ error: "Failed to update note" });
    }
}

export async function openNoteHandler(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const updated = await touchNote(accountId, id);
        if (!updated) {
            res.status(404).json({ error: "Note not found" });
            return;
        }

        res.json(updated);
    } catch (err) {
        console.error("Error opening note:", err);
        res.status(500).json({ error: "Failed to record note opening" });
    }
}

export async function deleteNoteHandler(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const deleted = await removeNote(accountId, id);
        if (!deleted) {
            res.status(404).json({ error: "Note not found" });
            return;
        }

        res.json({ message: "Note deleted successfully", id });
    } catch (err) {
        console.error("Error deleting note:", err);
        res.status(500).json({ error: "Failed to delete note" });
    }
}

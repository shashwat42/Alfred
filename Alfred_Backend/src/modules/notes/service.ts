import { tenantRepository } from "../../security/tenantRepository.ts";
import mongoose from "mongoose";
import { Note, type INote } from "../../models/note.model.ts";

export async function getNotes(accountId: string): Promise<INote[]> {
    return tenantRepository(Note, accountId).find({
        $or: [{ title: { $gt: "" } }, { content: { $gt: "" } }],
    }, { sort: { updatedAt: -1 } });
}

export async function getRecentNotes(accountId: string, limit = 4): Promise<INote[]> {
    return tenantRepository(Note, accountId).find({
        $or: [{ title: { $gt: "" } }, { content: { $gt: "" } }],
    }, { sort: { lastOpenedAt: -1, updatedAt: -1 }, limit });
}

export async function searchNotes(accountId: string, query: string): Promise<INote[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        return getNotes(accountId);
    }
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    return tenantRepository(Note, accountId).find({
        $or: [{ title: regex }, { content: regex }],
    }, { sort: { updatedAt: -1 } });
}

export async function createNote(
    accountId: string,
    title = "",
    content = ""
): Promise<INote> {
    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    // If both title and content are blank, do not persist an empty note
    if (!cleanTitle && !cleanContent) {
        throw new Error("Cannot create an empty note");
    }

    const note = await tenantRepository(Note, accountId).create({
        title: cleanTitle,
        content,
        lastOpenedAt: new Date(),
    });
    return note.toObject();
}

export async function updateNote(
    accountId: string,
    noteId: string,
    updates: { title?: string; content?: string }
): Promise<INote | null> {
    if (!mongoose.isValidObjectId(noteId)) {
        return null;
    }

    const updateData: { title?: string; content?: string; lastOpenedAt: Date } = {
        lastOpenedAt: new Date(),
    };

    if (updates.title !== undefined) {
        updateData.title = updates.title.trim();
    }
    if (updates.content !== undefined) {
        updateData.content = updates.content;
    }

    return tenantRepository(Note, accountId).findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(noteId),
        },
        updateData
    );
}

export async function touchNote(accountId: string, noteId: string): Promise<INote | null> {
    if (!mongoose.isValidObjectId(noteId)) {
        return null;
    }

    return tenantRepository(Note, accountId).findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(noteId),
        },
        { lastOpenedAt: new Date() }
    );
}

export async function deleteNote(accountId: string, noteId: string): Promise<INote | null> {
    if (!mongoose.isValidObjectId(noteId)) {
        return null;
    }

    return tenantRepository(Note, accountId).findOneAndDelete({
        _id: new mongoose.Types.ObjectId(noteId),
    });
}

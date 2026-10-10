import mongoose from "mongoose";
import { Note, type INote } from "../../models/note.model.ts";

export async function getNotes(accountId: string): Promise<INote[]> {
    // Also clean up any accidental legacy completely empty notes
    await Note.deleteMany({
        accountId: new mongoose.Types.ObjectId(accountId),
        $and: [
            { $or: [{ title: "" }, { title: null }, { title: { $exists: false } }] },
            { $or: [{ content: "" }, { content: null }, { content: { $exists: false } }] },
        ],
    }).catch(() => null);

    return Note.find({
        accountId: new mongoose.Types.ObjectId(accountId),
        $or: [{ title: { $gt: "" } }, { content: { $gt: "" } }],
    })
        .sort({ updatedAt: -1 })
        .lean();
}

export async function getRecentNotes(accountId: string, limit = 4): Promise<INote[]> {
    return Note.find({
        accountId: new mongoose.Types.ObjectId(accountId),
        $or: [{ title: { $gt: "" } }, { content: { $gt: "" } }],
    })
        .sort({ lastOpenedAt: -1, updatedAt: -1 })
        .limit(limit)
        .lean();
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

    const note = await Note.create({
        accountId: new mongoose.Types.ObjectId(accountId),
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

    return Note.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(noteId),
            accountId: new mongoose.Types.ObjectId(accountId),
        },
        { $set: updateData },
        { returnDocument: "after" }
    ).lean();
}

export async function touchNote(accountId: string, noteId: string): Promise<INote | null> {
    if (!mongoose.isValidObjectId(noteId)) {
        return null;
    }

    return Note.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(noteId),
            accountId: new mongoose.Types.ObjectId(accountId),
        },
        { $set: { lastOpenedAt: new Date() } },
        { returnDocument: "after" }
    ).lean();
}

export async function deleteNote(accountId: string, noteId: string): Promise<INote | null> {
    if (!mongoose.isValidObjectId(noteId)) {
        return null;
    }

    return Note.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(noteId),
        accountId: new mongoose.Types.ObjectId(accountId),
    }).lean();
}

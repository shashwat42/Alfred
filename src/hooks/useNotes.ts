import { useState, useEffect, useCallback } from "react";
import { useLoadState } from "./useLoadState";
import { httpMessage } from "../lib/requestError";
import { apiFetch } from "../lib/api.ts";
import type { NoteItem } from "../types/notes.ts";

function isValidNote(n: NoteItem): boolean {
    if (!n || !n._id) return false;
    const cleanTitle = (n.title || "").trim();
    const cleanContent = (n.content || "").replace(/<[^>]*>/g, "").trim();
    return cleanTitle.length > 0 || cleanContent.length > 0;
}

export function useNotes(accountId: string | undefined) {
    const { run, ...loadState } = useLoadState();
    const [notes, setNotes] = useState<NoteItem[]>([]);
    const [recentNotes, setRecentNotes] = useState<NoteItem[]>([]);
    const [activeNote, setActiveNote] = useState<NoteItem | null>(null);
    const [notesError, setNotesError] = useState("");

    const loadNotes = useCallback(async () => run(async () => {
        if (!accountId) return;
        try {
            const res = await apiFetch("/api/notes");
            if (res.ok) {
                const data: NoteItem[] = await res.json();
                setNotes(data.filter(isValidNote));
            } else {
                throw new Error(httpMessage(res.status));
            }
        } catch (err) {
            console.error("Failed to load notes:", err);
            throw err;
        }
    }), [accountId, run]);

    const loadRecentNotes = useCallback(async () => run(async () => {
        if (!accountId) return;
        try {
            const res = await apiFetch("/api/notes/recent?limit=4");
            if (res.ok) {
                const data: NoteItem[] = await res.json();
                setRecentNotes(data.filter(isValidNote));
            } else {
                throw new Error(httpMessage(res.status));
            }
        } catch (err) {
            console.error("Failed to load recent notes:", err);
            throw err;
        }
    }), [accountId, run]);

    const refreshNotes = useCallback(async () => {
        if (!accountId) return;
        await Promise.all([loadNotes(), loadRecentNotes()]);
    }, [accountId, loadNotes, loadRecentNotes]);

    useEffect(() => {
        if (!accountId) return;

        void refreshNotes().catch(() => {});

        const handleActionExecuted = (event: Event) => {
            const customEvt = event as CustomEvent<{ actions?: Array<{ type?: string }> }>;
            const actions = customEvt.detail?.actions;
            if (Array.isArray(actions) && actions.some((a) => a.type && a.type.startsWith("note_"))) {
                void refreshNotes().catch(() => {});
            }
        };

        window.addEventListener("alfred:action_executed", handleActionExecuted);

        return () => {

            window.removeEventListener("alfred:action_executed", handleActionExecuted);
        };
    }, [accountId, refreshNotes]);

    const saveNote = async (payload: { id?: string; title?: string; content?: string }): Promise<NoteItem | null> => {
        setNotesError("");

        const cleanTitle = (payload.title ?? "").trim();
        const cleanContent = (payload.content ?? "").trim();
        const plainText = cleanContent.replace(/<[^>]*>/g, "").trim();

        // If it's a new draft and still completely blank, do not create an empty DB document
        if (!payload.id && !cleanTitle && !plainText) {
            return null;
        }

        try {
            const isEditing = Boolean(payload.id);
            const endpoint = isEditing ? `/api/notes/${payload.id}` : "/api/notes";
            const method = isEditing ? "PUT" : "POST";

            const res = await apiFetch(endpoint, {
                method,
                body: JSON.stringify({
                    title: cleanTitle,
                    content: payload.content ?? "",
                }),
            });

            if (!res.ok) {
                const errorData = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(errorData?.error || `Failed to save note: ${res.status}`);
            }

            const savedNote: NoteItem = await res.json();

            setNotes((prev) => {
                const existingIndex = prev.findIndex((n) => n._id === savedNote._id);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = savedNote;
                    return updated;
                }
                return [savedNote, ...prev];
            });

            setRecentNotes((prev) => {
                const filtered = prev.filter((n) => n._id !== savedNote._id && isValidNote(n));
                return [savedNote, ...filtered].slice(0, 4);
            });

            if (activeNote?._id === savedNote._id || !activeNote?._id) {
                setActiveNote(savedNote);
            }

            return savedNote;
        } catch (err) {
            console.error("Error saving note:", err);
            setNotesError(err instanceof Error ? err.message : "Failed to save note");
            return null;
        }
    };

    const deleteNote = async (id: string): Promise<boolean> => {
        try {
            const res = await apiFetch(`/api/notes/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setNotes((prev) => prev.filter((n) => n._id !== id));
                setRecentNotes((prev) => prev.filter((n) => n._id !== id));
                if (activeNote?._id === id) {
                    setActiveNote(null);
                }
                return true;
            }
            return false;
        } catch (err) {
            console.error("Error deleting note:", err);
            return false;
        }
    };

    const openNote = async (note: NoteItem) => {
        setActiveNote(note);
        if (!note._id) return; // Never record or put empty drafts in recentNotes

        try {
            void apiFetch(`/api/notes/${note._id}/open`, { method: "PATCH" });
            setRecentNotes((prev) => {
                const updatedNote = { ...note, lastOpenedAt: new Date().toISOString() };
                const filtered = prev.filter((n) => n._id !== note._id && isValidNote(n));
                return [updatedNote, ...filtered].slice(0, 4);
            });
        } catch (err) {
            console.error("Error recording note open:", err);
        }
    };

    return {
        notes,
        recentNotes,
        activeNote,
        setActiveNote,
        ...loadState,
        notesError,
        loadNotes,
        loadRecentNotes,
        refreshNotes,
        saveNote,
        deleteNote,
        openNote,
    };
}

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
    ChevronLeft,
    Search,
    Plus,
    Minus,
    Trash2,
    Check,
    SquarePen,
    Bold,
    Italic,
    Underline,
    List,
    ListOrdered,
    Undo2,
    Redo2,
    FileDown,
    X,
} from "lucide-react";
import type { NoteItem } from "../../types/notes.ts";

interface NotesViewProps {
    notes: NoteItem[];
    activeNote: NoteItem | null;
    onSelectNote: (note: NoteItem) => void;
    onSaveNote: (note: { id?: string; title?: string; content?: string }) => Promise<NoteItem | null>;
    onDeleteNote: (id: string) => Promise<boolean>;
    onBackToList: () => void;
}

const PRESET_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24];

function sanitizeForPreview(htmlOrText: string): string[] {
    if (!htmlOrText) return [];
    return htmlOrText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, 8);
}

/**
 * Triggers the native Windows "Save As" file dialog modal via WebView2 / Chromium File System Access API.
 * Falls back to browser download if user agent does not support showSaveFilePicker.
 */
async function saveFileWithPicker(
    content: Blob | string,
    defaultName: string,
    mimeType: string,
    extension: string
) {
    type FilePickerWindow = Window & {
        showSaveFilePicker?: (options: {
            suggestedName: string;
            types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
            createWritable: () => Promise<{
                write: (data: Blob | string) => Promise<void>;
                close: () => Promise<void>;
            }>;
        }>;
    };

    const win = window as FilePickerWindow;

    if (typeof win.showSaveFilePicker === "function") {
        try {
            const handle = await win.showSaveFilePicker({
                suggestedName: defaultName,
                types: [
                    {
                        description: `${extension.toUpperCase()} Document`,
                        accept: { [mimeType]: [`.${extension}`] },
                    },
                ],
            });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (err: unknown) {
            // If the user cancelled out of the Windows file dialog
            if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
                return false;
            }
        }
    }

    // Fallback: standard browser anchor download
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

export function NotesView({
    notes,
    activeNote,
    onSelectNote,
    onSaveNote,
    onDeleteNote,
    onBackToList,
}: NotesViewProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);

    // Export dropdown state
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

    // Editor local state
    const [editId, setEditId] = useState<string | undefined>(activeNote?._id);
    const [title, setTitle] = useState(activeNote?.title ?? "");
    const [content, setContent] = useState(activeNote?.content ?? "");
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
    const [currentFontSize, setCurrentFontSize] = useState<number>(15);
    const [isFontSizeMenuOpen, setIsFontSizeMenuOpen] = useState(false);

    // Track active formatting states (bold, italic, underline, list)
    const [activeFormats, setActiveFormats] = useState({
        bold: false,
        italic: false,
        underline: false,
        bullet: false,
        numbered: false,
    });

    const editorRef = useRef<HTMLDivElement | null>(null);
    const isDeletingRef = useRef(false);

    // Keep track of the last persisted values to avoid false "unsaved" flags on still notes
    const lastSavedRef = useRef<{ id?: string; title: string; content: string }>({
        id: activeNote?._id,
        title: activeNote?.title ?? "",
        content: activeNote?.content ?? "",
    });

    const isEditorOpen = Boolean(activeNote);

    // Check active formatting at cursor position
    const checkActiveFormats = useCallback(() => {
        try {
            setActiveFormats({
                bold: document.queryCommandState("bold"),
                italic: document.queryCommandState("italic"),
                underline: document.queryCommandState("underline"),
                bullet: document.queryCommandState("insertUnorderedList"),
                numbered: document.queryCommandState("insertOrderedList"),
            });

            // Detect font size at current cursor selection
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const node = selection.anchorNode;
                const element =
                    node?.nodeType === Node.ELEMENT_NODE
                        ? (node as HTMLElement)
                        : node?.parentElement;
                if (element) {
                    const computed = window.getComputedStyle(element).fontSize;
                    const parsed = parseInt(computed, 10);
                    if (!isNaN(parsed) && parsed >= 10 && parsed <= 40) {
                        setCurrentFontSize(parsed);
                    }
                }
            }
        } catch {
            // Ignore queryCommandState errors if not focused
        }
    }, []);

    // Sync editor state when activeNote changes
    useEffect(() => {
        if (activeNote) {
            setEditId(activeNote._id);
            setTitle(activeNote.title || "");
            const noteContent = activeNote.content || "";
            setContent(noteContent);
            lastSavedRef.current = {
                id: activeNote._id,
                title: activeNote.title || "",
                content: noteContent,
            };
            setSaveStatus("saved");

            if (editorRef.current && editorRef.current.innerHTML !== noteContent) {
                editorRef.current.innerHTML = noteContent;
            }
        } else {
            setEditId(undefined);
            setTitle("");
            setContent("");
            lastSavedRef.current = { id: undefined, title: "", content: "" };
            setSaveStatus("saved");
            if (editorRef.current) {
                editorRef.current.innerHTML = "";
            }
        }
    }, [activeNote]);

    // Debounced auto-save when user edits
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!isEditorOpen || isDeletingRef.current) return;

        const isChanged =
            title !== lastSavedRef.current.title ||
            content !== lastSavedRef.current.content;

        if (!isChanged) {
            setSaveStatus("saved");
            return;
        }

        const plainText = content.replace(/<[^>]*>/g, "").trim();
        // Do not auto-save completely empty draft note
        if (!editId && !title.trim() && !plainText) {
            setSaveStatus("saved");
            return;
        }

        setSaveStatus("unsaved");
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (isDeletingRef.current) return;
            setSaveStatus("saving");
            const result = await onSaveNote({
                id: editId,
                title: title.trim(),
                content,
            });
            if (result && !isDeletingRef.current) {
                if (!editId) {
                    setEditId(result._id);
                }
                lastSavedRef.current = {
                    id: result._id,
                    title: title.trim(),
                    content,
                };
                setSaveStatus("saved");
            } else {
                setSaveStatus("unsaved");
            }
        }, 800);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [title, content, editId, isEditorOpen, onSaveNote]);

    const handleEditorInput = () => {
        if (editorRef.current) {
            setContent(editorRef.current.innerHTML);
            checkActiveFormats();
        }
    };

    // Rich text visual formatting
    const execCommand = (command: string, value: string | undefined = undefined) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        document.execCommand(command, false, value);
        handleEditorInput();
        checkActiveFormats();
    };

    // Apply font size specifically to the active selection or current paragraph/line
    const applyFontSizeToSelection = (sizePx: number) => {
        setCurrentFontSize(sizePx);
        setIsFontSizeMenuOpen(false);
        if (!editorRef.current) return;
        editorRef.current.focus();

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);

        if (range.collapsed) {
            // Apply to enclosing block or paragraph
            let node: Node | null = range.startContainer;
            while (node && node !== editorRef.current && node.parentElement !== editorRef.current) {
                node = node.parentElement;
            }
            if (node && node instanceof HTMLElement) {
                node.style.fontSize = `${sizePx}px`;
                handleEditorInput();
                return;
            }
        }

        // Has selected text: wrap selection in styled span
        const span = document.createElement("span");
        span.style.fontSize = `${sizePx}px`;
        try {
            span.appendChild(range.extractContents());
            range.insertNode(span);
            selection.removeAllRanges();
            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            selection.addRange(newRange);
            handleEditorInput();
        } catch {
            // Fallback: document font size
            document.execCommand("fontSize", false, "3");
        }
    };

    // List navigation: Enter and Backspace handling on empty list items
    const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return;
            const anchor = selection.anchorNode;
            const li =
                anchor?.nodeType === Node.ELEMENT_NODE
                    ? (anchor as Element).closest("li")
                    : anchor?.parentElement?.closest("li");
            if (li) {
                const text = (li.textContent || "").trim();
                if (!text) {
                    // Enter on empty list item -> exit list cleanly
                    e.preventDefault();
                    document.execCommand("outdent", false);
                    handleEditorInput();
                }
            }
        } else if (e.key === "Backspace") {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return;
            const anchor = selection.anchorNode;
            const li =
                anchor?.nodeType === Node.ELEMENT_NODE
                    ? (anchor as Element).closest("li")
                    : anchor?.parentElement?.closest("li");
            if (li) {
                const text = (li.textContent || "").trim();
                if (!text) {
                    // Backspace on empty list item -> convert back to regular line at same position
                    e.preventDefault();
                    document.execCommand("outdent", false);
                    handleEditorInput();
                }
            }
        }
        setTimeout(checkActiveFormats, 10);
    };

    const handleManualSave = async () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const plainText = content.replace(/<[^>]*>/g, "").trim();
        if (!editId && !title.trim() && !plainText) {
            setSaveStatus("saved");
            return;
        }

        setSaveStatus("saving");
        const result = await onSaveNote({
            id: editId,
            title: title.trim(),
            content,
        });
        if (result) {
            if (!editId) {
                setEditId(result._id);
            }
            lastSavedRef.current = {
                id: result._id,
                title: title.trim(),
                content,
            };
            setSaveStatus("saved");
        } else {
            setSaveStatus("unsaved");
        }
    };

    const handleDeleteCurrentNote = async () => {
        if (editId) {
            const confirmed = window.confirm("Delete this note?");
            if (confirmed) {
                isDeletingRef.current = true;
                if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                }
                if (editorRef.current) {
                    editorRef.current.innerHTML = "";
                }
                await onDeleteNote(editId);
                onBackToList();
                setTimeout(() => {
                    isDeletingRef.current = false;
                }, 100);
            }
        } else {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (editorRef.current) {
                editorRef.current.innerHTML = "";
            }
            onBackToList();
        }
    };

    const handleStartNewNote = () => {
        const draft: NoteItem = {
            _id: "",
            title: "",
            content: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        onSelectNote(draft);
    };

    // Filter valid notes (hide empty phantom notes)
    const validNotes = useMemo(() => {
        return notes.filter((n) => {
            if (!n._id) return false;
            const plainText = (n.content || "").replace(/<[^>]*>/g, "").trim();
            const cleanTitle = (n.title || "").trim();
            return plainText.length > 0 || cleanTitle.length > 0;
        });
    }, [notes]);

    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return validNotes;
        const q = searchQuery.toLowerCase();
        return validNotes.filter(
            (n) =>
                n.title?.toLowerCase().includes(q) ||
                n.content?.toLowerCase().includes(q)
        );
    }, [validNotes, searchQuery]);

    // Group notes by month
    const groupedNotes = useMemo(() => {
        const groups: { [key: string]: NoteItem[] } = {};
        for (const note of filteredNotes) {
            const date = new Date(note.updatedAt || note.createdAt || Date.now());
            const monthLabel = date.toLocaleDateString("en-US", { month: "short" });
            if (!groups[monthLabel]) {
                groups[monthLabel] = [];
            }
            groups[monthLabel].push(note);
        }
        return groups;
    }, [filteredNotes]);

    const formatCardDate = (dateStr?: string) => {
        if (!dateStr) return "";
        const date = new Date(dateStr);
        return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    };

    // Export As handler (for current active note only)
    const handleExportAs = async (format: "txt" | "doc") => {
        setIsExportMenuOpen(false);

        const cleanTitle = title.trim() || "Untitled Note";
        const plainTextBody = content
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .trim();

        if (!title.trim() && !plainTextBody) {
            return;
        }

        const filenameBase = cleanTitle.toLowerCase().replace(/[^a-z0-9_-]/gi, "_");

        if (format === "txt") {
            const plainText = `${cleanTitle}\n${"=".repeat(cleanTitle.length)}\n\n${plainTextBody}`;
            await saveFileWithPicker(
                plainText,
                `${filenameBase}.txt`,
                "text/plain",
                "txt"
            );
        } else if (format === "doc") {
            const docContent = `
                <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                <head><meta charset='utf-8'><title>${cleanTitle}</title></head>
                <body style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5;">
                    <h1>${cleanTitle}</h1>
                    <div>${content}</div>
                </body>
                </html>
            `;
            await saveFileWithPicker(
                docContent,
                `${filenameBase}.doc`,
                "application/msword",
                "doc"
            );
        }
    };

    // ----------------------------------------------------
    // Note Editor View (Visual WYSIWYG)
    // ----------------------------------------------------
    if (isEditorOpen) {
        return (
            <div key="note-editor" className="note-editor-wrapper">
                {/* Editor Header */}
                <div className="note-editor-header">
                    <div className="note-editor-header-left">
                        <button
                            type="button"
                            className="note-editor-icon-btn"
                            onClick={onBackToList}
                            title="Back to notes"
                        >
                            <ChevronLeft size={24} />
                        </button>
                        <input
                            type="text"
                            className="note-editor-title-input"
                            placeholder="Title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div className="note-editor-header-right">
                        {/* Export As Menu in Editor (Disabled if note has no content) */}
                        <div className="note-export-menu-wrapper">
                            {(() => {
                                const isNoteEmpty = !title.trim() && !content.replace(/<[^>]*>/g, "").trim();
                                return (
                                    <>
                                        <button
                                            type="button"
                                            className="note-editor-icon-btn"
                                            disabled={isNoteEmpty}
                                            onClick={() => {
                                                if (isNoteEmpty) return;
                                                setIsExportMenuOpen((prev) => !prev);
                                            }}
                                            title={isNoteEmpty ? "Cannot export an empty note" : "Export Note"}
                                        >
                                            <FileDown size={19} />
                                        </button>
                                        {isExportMenuOpen && !isNoteEmpty && (
                                            <div className="note-export-dropdown-menu">
                                                <span className="export-menu-title">Save / Export As</span>
                                                <button
                                                    type="button"
                                                    className="export-menu-item-btn"
                                                    onClick={() => handleExportAs("txt")}
                                                >
                                                    Text File (.txt)
                                                </button>
                                                <button
                                                    type="button"
                                                    className="export-menu-item-btn"
                                                    onClick={() => handleExportAs("doc")}
                                                >
                                                    Word Document (.doc)
                                                </button>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>

                        {/* Prominent Save / Status Action Button */}
                        <button
                            type="button"
                            className={`note-save-action-btn status-${saveStatus}`}
                            onClick={handleManualSave}
                            disabled={saveStatus === "saved"}
                            title={saveStatus === "saved" ? "All changes saved" : "Click to save"}
                        >
                            <Check size={16} />
                            <span>
                                {saveStatus === "saving"
                                    ? "Saving..."
                                    : saveStatus === "unsaved"
                                      ? "Save"
                                      : "Saved"}
                            </span>
                        </button>

                        <button
                            type="button"
                            className="note-editor-icon-btn delete-icon-btn"
                            onClick={handleDeleteCurrentNote}
                            title="Delete note"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>

                {/* Editor Visual Canvas */}
                <div className="note-editor-body">
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="note-editor-rich-canvas"
                        onInput={handleEditorInput}
                        onKeyDown={handleEditorKeyDown}
                        onKeyUp={checkActiveFormats}
                        onMouseUp={checkActiveFormats}
                        data-placeholder="Start typing your note here..."
                    />
                </div>

                {/* Editor Bottom Formatting Bar */}
                <div className="note-editor-bottom-bar">
                    {/* Bold */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.bold ? "is-active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("bold");
                        }}
                        title="Bold"
                    >
                        <Bold size={17} />
                    </button>

                    {/* Italic */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.italic ? "is-active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("italic");
                        }}
                        title="Italic"
                    >
                        <Italic size={17} />
                    </button>

                    {/* Underline */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.underline ? "is-active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("underline");
                        }}
                        title="Underline"
                    >
                        <Underline size={17} />
                    </button>

                    <div className="note-format-divider" />

                    {/* Bullet List */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.bullet ? "is-active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("insertUnorderedList");
                        }}
                        title="Bullet List"
                    >
                        <List size={18} />
                    </button>

                    {/* Numbered List */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.numbered ? "is-active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("insertOrderedList");
                        }}
                        title="Numbered List"
                    >
                        <ListOrdered size={18} />
                    </button>

                    <div className="note-format-divider" />

                    {/* Text Size for selected line / block: [-] [Aa size] [+] */}
                    <div className="note-size-control-group">
                        <button
                            type="button"
                            className="note-size-adjust-btn"
                            onClick={() => applyFontSizeToSelection(Math.max(12, currentFontSize - 1))}
                            title="Decrease text size"
                        >
                            <Minus size={13} />
                        </button>

                        <div className="note-size-menu-wrapper">
                            <button
                                type="button"
                                className="note-font-size-btn"
                                onClick={() => setIsFontSizeMenuOpen((prev) => !prev)}
                                title="Pick font size for line / selection"
                            >
                                <span>Aa {currentFontSize}</span>
                            </button>

                            {isFontSizeMenuOpen && (
                                <div className="note-size-dropdown-menu">
                                    {PRESET_FONT_SIZES.map((sz) => (
                                        <button
                                            key={sz}
                                            type="button"
                                            className={`note-size-option-btn ${sz === currentFontSize ? "active" : ""}`}
                                            onClick={() => applyFontSizeToSelection(sz)}
                                        >
                                            {sz}px
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            className="note-size-adjust-btn"
                            onClick={() => applyFontSizeToSelection(Math.min(28, currentFontSize + 1))}
                            title="Increase text size"
                        >
                            <Plus size={13} />
                        </button>
                    </div>

                    <div className="note-format-divider" />

                    {/* Undo */}
                    <button
                        type="button"
                        className="note-format-btn"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("undo");
                        }}
                        title="Undo"
                    >
                        <Undo2 size={17} />
                    </button>

                    {/* Redo */}
                    <button
                        type="button"
                        className="note-format-btn"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            execCommand("redo");
                        }}
                        title="Redo"
                    >
                        <Redo2 size={17} />
                    </button>
                </div>
            </div>
        );
    }

    // ----------------------------------------------------
    // Notes Card Gallery View
    // ----------------------------------------------------
    return (
        <div key="notes-gallery" className="notes-gallery-wrapper">
            {/* Gallery Top Action Bar */}
            <div className="notes-gallery-top-bar">
                <div className="notes-gallery-title-wrap">
                    <h2 className="notes-gallery-title">Notes</h2>
                    <span className="notes-count-badge">{filteredNotes.length}</span>
                </div>

                <div className="notes-gallery-actions">
                    {isSearching ? (
                        <div className="notes-search-input-box">
                            <Search size={16} className="notes-search-icon-inside" />
                            <input
                                type="text"
                                className="notes-search-input"
                                placeholder="Search notes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <button
                                type="button"
                                className="notes-search-clear"
                                onClick={() => {
                                    setSearchQuery("");
                                    setIsSearching(false);
                                }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="notes-gallery-icon-btn"
                            onClick={() => setIsSearching(true)}
                            title="Search notes"
                        >
                            <Search size={20} />
                        </button>
                    )}



                    <button
                        type="button"
                        className="notes-gallery-icon-btn highlight-add-btn"
                        onClick={handleStartNewNote}
                        title="Create New Note"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            </div>

            {/* Gallery Scroll Content with Month Sections */}
            <div className="notes-gallery-scroll-area">
                {Object.keys(groupedNotes).length === 0 ? (
                    <div className="notes-empty-state">
                        <SquarePen size={44} className="notes-empty-icon" />
                        <p className="notes-empty-text">No notes yet</p>
                        <button
                            type="button"
                            className="notes-empty-create-btn"
                            onClick={handleStartNewNote}
                        >
                            Create your first note
                        </button>
                    </div>
                ) : (
                    Object.entries(groupedNotes).map(([month, monthNotes]) => (
                        <div key={month} className="notes-month-group">
                            <div className="notes-month-header">{month}</div>
                            <div className="notes-cards-grid">
                                {monthNotes.map((note) => {
                                    const displayTitle = note.title.trim() || "No title";
                                    const displayDate = formatCardDate(note.updatedAt || note.createdAt);
                                    const previewLines = sanitizeForPreview(note.content);

                                    return (
                                        <div
                                            key={note._id}
                                            className="note-card-item"
                                            onClick={() => onSelectNote(note)}
                                        >
                                            {/* Preview Card Box */}
                                            <div className="note-card-box">
                                                <div className="note-card-content-preview">
                                                    {previewLines.length > 0 ? (
                                                        previewLines.map((line, idx) => (
                                                            <div key={idx} className="note-preview-line">
                                                                {line}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <span className="note-preview-empty">Empty note</span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    className="note-card-delete-quick-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm("Delete note?")) {
                                                            void onDeleteNote(note._id);
                                                        }
                                                    }}
                                                    title="Delete note"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            {/* Note Info Underneath Card */}
                                            <div className="note-card-footer">
                                                <h4 className="note-card-title" title={displayTitle}>
                                                    {displayTitle}
                                                </h4>
                                                <span className="note-card-date">{displayDate}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Floating Action Button */}
            <button
                type="button"
                className="notes-floating-action-btn"
                onClick={handleStartNewNote}
                title="Create Note"
            >
                <SquarePen size={22} color="#ffffff" />
            </button>
        </div>
    );
}

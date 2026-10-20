import { ErrorNotice } from "../reliability/Notifications";
import { notePlainText } from "../../lib/noteText.ts";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
    Copy,
    Type,
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
    operationError?: string;
}

const PRESET_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24];

function sanitizeForPreview(htmlOrText: string): string[] {
    const plain = notePlainText(htmlOrText);
    return plain ? plain.split("\n").map(line => line.trim()).slice(0, 3) : [];
}

export function NotesView({
    notes,
    activeNote,
    onSelectNote,
    onSaveNote,
    onDeleteNote,
    onBackToList,
    operationError,
}: NotesViewProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);

    // Editor local state
    const [editId, setEditId] = useState<string | undefined>(activeNote?._id);
    const [title, setTitle] = useState(activeNote?.title ?? "");
    const [content, setContent] = useState(activeNote?.content ?? "");
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
    const [currentFontSize, setCurrentFontSize] = useState<number>(15);
    const [formatOpen, setFormatOpen] = useState(false);
    const formatToggleRef = useRef<HTMLButtonElement | null>(null);
    const closeFormatting = () => {
        setFormatOpen(false);
        setIsFontSizeMenuOpen(false);
        formatToggleRef.current?.focus();
    };
    const [copyFeedback, setCopyFeedback] = useState("");
    const selectedRange = useRef<Range | null>(null);
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
    const savingRef = useRef(false);
    const [saveRevision, setSaveRevision] = useState(0);
    const editorSessionRef = useRef(0);
    const latestEditRef = useRef({ title, content });
    useEffect(() => { latestEditRef.current = { title, content }; }, [title, content]);

    // Keep track of the last persisted values to avoid false "unsaved" flags on still notes
    const lastSavedRef = useRef<{ id?: string; title: string; content: string }>({
        id: activeNote?._id,
        title: activeNote?.title ?? "",
        content: activeNote?.content ?? "",
    });

    const isEditorOpen = Boolean(activeNote);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent("alfred:note-open", { detail: isEditorOpen }));
        return () => { window.dispatchEvent(new CustomEvent("alfred:note-open", { detail: false })); };
    }, [isEditorOpen]);
    const rememberSelection = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) selectedRange.current = selection.getRangeAt(0).cloneRange();
    };
    const restoreSelection = () => {
        const selection = window.getSelection();
        if (selectedRange.current && selection && editorRef.current?.contains(selectedRange.current.startContainer)) {
            selection.removeAllRanges(); selection.addRange(selectedRange.current);
        }
    };
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

    // Synchronize local state with activeNote during render when activeNote changes
    const [prevActiveNote, setPrevActiveNote] = useState<NoteItem | null>(activeNote);
    if (activeNote?._id !== prevActiveNote?._id || Boolean(activeNote) !== Boolean(prevActiveNote)) {
        setPrevActiveNote(activeNote);
        setEditId(activeNote?._id);
        setTitle(activeNote?.title || "");
        setContent(activeNote?.content || "");
        setSaveStatus("saved");
    }

    // Keep DOM and lastSavedRef in sync when activeNote changes
    useEffect(() => {
        editorSessionRef.current++;
        lastSavedRef.current = {
            id: prevActiveNote?._id,
            title: prevActiveNote?.title || "",
            content: prevActiveNote?.content || "",
        };
        if (editorRef.current) {
            const noteContent = prevActiveNote?.content || "";
            if (editorRef.current.innerHTML !== noteContent) {
                editorRef.current.innerHTML = noteContent;
            }
        }
    }, [prevActiveNote]);

    // Debounced auto-save when user edits
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!isEditorOpen || isDeletingRef.current || savingRef.current) return;

        const isChanged =
            title.trim() !== lastSavedRef.current.title ||
            content !== lastSavedRef.current.content;

        if (!isChanged) {
            return;
        }

        const plainText = content.replace(/<[^>]*>/g, "").trim();
        // Do not auto-save completely empty draft note
        if (!editId && !title.trim() && !plainText) {
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (isDeletingRef.current || savingRef.current) return;
            savingRef.current = true;
            const editorSession = editorSessionRef.current;
            setSaveStatus("saving");
            const result = await onSaveNote({
                id: editId,
                title: title.trim(),
                content,
            });
            savingRef.current = false;
            if (result || editorSession !== editorSessionRef.current) setSaveRevision(value => value + 1);
            if (editorSession !== editorSessionRef.current) return;
            if (result && !isDeletingRef.current) {
                if (!editId) {
                    setEditId(result._id);
                }
                lastSavedRef.current = {
                    id: result._id,
                    title: title.trim(),
                    content,
                };
                setSaveStatus(latestEditRef.current.title === title && latestEditRef.current.content === content ? "saved" : "unsaved");
            } else {
                setSaveStatus("unsaved");
            }
        }, 800);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [title, content, editId, isEditorOpen, onSaveNote, saveRevision]);

    const handleEditorInput = () => {
        if (editorRef.current) {
            setContent(editorRef.current.innerHTML);
            setSaveStatus("unsaved");
            checkActiveFormats();
        }
    };

    // Rich text visual formatting
    const execCommand = (command: string, value: string | undefined = undefined) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        restoreSelection();
        document.execCommand(command, false, value);
        handleEditorInput();
        checkActiveFormats(); rememberSelection();
    };

    // Apply font size specifically to the active selection or current paragraph/line
    const applyFontSizeToSelection = (sizePx: number) => {
        setCurrentFontSize(sizePx);
        setIsFontSizeMenuOpen(false);
        if (!editorRef.current) return;
        editorRef.current.focus();
        restoreSelection();

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
        if (savingRef.current) return;
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const plainText = content.replace(/<[^>]*>/g, "").trim();
        if (!editId && !title.trim() && !plainText) {
            setSaveStatus("saved");
            return;
        }

        savingRef.current = true;
        const editorSession = editorSessionRef.current;
        setSaveStatus("saving");
        const result = await onSaveNote({
            id: editId,
            title: title.trim(),
            content,
        });
        savingRef.current = false;
        if (result || editorSession !== editorSessionRef.current) setSaveRevision(value => value + 1);
        if (editorSession !== editorSessionRef.current) return;
        if (result) {
            if (!editId) {
                setEditId(result._id);
            }
            lastSavedRef.current = {
                id: result._id,
                title: title.trim(),
                content,
            };
            setSaveStatus(latestEditRef.current.title === title && latestEditRef.current.content === content ? "saved" : "unsaved");
        } else {
            setSaveStatus("unsaved");
        }
    };

    const leaveEditor = async (after?: () => void) => {
        if (savingRef.current) return;
        await handleManualSave();
        const latest = latestEditRef.current, saved = lastSavedRef.current;
        if (latest.title.trim() === saved.title && latest.content === saved.content) { if (after) after(); else onBackToList(); }
    };
    const leaveRef = useRef(leaveEditor);
    useEffect(() => { leaveRef.current = leaveEditor; });
    useEffect(() => {
        if (!isEditorOpen) return;
        const back = (event: Event) => { if (document.querySelector("dialog[open]")) return; event.preventDefault(); void leaveRef.current(); };
        const navigate = (event: Event) => { event.preventDefault(); void leaveRef.current((event as CustomEvent<() => void>).detail); };
        window.addEventListener("alfred:back", back, true); window.addEventListener("alfred:before-navigate", navigate);
        return () => { window.removeEventListener("alfred:back", back, true); window.removeEventListener("alfred:before-navigate", navigate); };
    }, [isEditorOpen]);

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
            const dateStr = note.updatedAt || note.createdAt;
            const date = dateStr ? new Date(dateStr) : new Date(0);
            const monthLabel = dateStr ? date.toLocaleDateString("en-US", { month: "short" }) : "Recent";
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

    // ----------------------------------------------------
    // Note Editor View (Visual WYSIWYG)
    // ----------------------------------------------------
    if (isEditorOpen) {
        return (
            <div key="note-editor" className="note-editor-wrapper" onKeyDown={(event) => {
                if (event.key === "Escape" && formatOpen) {
                    event.preventDefault();
                    closeFormatting();
                }
            }}>
                <ErrorNotice message={operationError} />
                {/* Editor Header */}
                <div className="note-editor-header">
                    <div className="note-editor-header-left">
                        <button
                            type="button"
                            className="note-editor-icon-btn"
                            onClick={() => void leaveEditor()}
                            title="Back to notes"
                        >
                            <ChevronLeft size={24} />
                        </button>
                        <input
                            type="text"
                            className="note-editor-title-input"
                            aria-label="Note title"
                            placeholder="Title"
                            value={title}
                            onChange={(e) => {
                                setTitle(e.target.value);
                                setSaveStatus("unsaved");
                            }}
                        />
                    </div>

                    <div className="note-editor-header-right">
                        <button ref={formatToggleRef} type="button" className="note-format-toggle" aria-label="Toggle formatting sidebar" title="Formatting" aria-expanded={formatOpen} aria-controls="note-formatting" onPointerDown={rememberSelection} onClick={() => {
                            setFormatOpen(!formatOpen);
                            setIsFontSizeMenuOpen(false);
                        }}><Type size={18} /><span>Formatting</span></button>
                        {/* Prominent Save / Status Action Button */}
                        <button
                            type="button"
                            className={`note-save-action-btn status-${saveStatus}`}
                            onClick={handleManualSave}
                            disabled={saveStatus !== "unsaved"}
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
                <div className="note-editor-workspace">
                <div className="note-editor-body">
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="note-editor-rich-canvas"
                        role="textbox"
                        aria-label="Note content"
                        aria-multiline="true"
                        onInput={handleEditorInput}
                        onKeyDown={handleEditorKeyDown}
                        onKeyUp={() => { checkActiveFormats(); rememberSelection(); }}
                        onMouseUp={() => { checkActiveFormats(); rememberSelection(); }}
                        onTouchEnd={rememberSelection}
                        data-placeholder="Start typing your note here..."
                    />
                </div>

                <aside id="note-formatting" className="note-format-sidebar" aria-label="Formatting" hidden={!formatOpen} onPointerDownCapture={rememberSelection}>
                    <div className="note-format-sidebar-header">
                        <strong>Formatting</strong>
                        <button type="button" className="note-editor-icon-btn" aria-label="Close formatting sidebar" onClick={closeFormatting}><X size={18} /></button>
                    </div>
                    <div className="note-format-tools">
                    <button type="button" className="note-format-btn" title="Copy content" aria-label="Copy content" onClick={() => {
                        if (!navigator.clipboard?.writeText) { setCopyFeedback("Copy is unavailable. Please select and copy the text."); return; }
                        void navigator.clipboard.writeText(notePlainText(content)).then(() => setCopyFeedback("Copied content.")).catch(() => setCopyFeedback("Could not copy. Please select and copy the text."));
                    }}><Copy size={17} /></button>
                    {/* Bold */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.bold ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("bold")}
                        title="Bold"
                    >
                        <Bold size={17} />
                    </button>

                    {/* Italic */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.italic ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("italic")}
                        title="Italic"
                    >
                        <Italic size={17} />
                    </button>

                    {/* Underline */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.underline ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("underline")}
                        title="Underline"
                    >
                        <Underline size={17} />
                    </button>

                    <div className="note-format-divider" />

                    {/* Bullet List */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.bullet ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("insertUnorderedList")}
                        title="Bullet List"
                    >
                        <List size={18} />
                    </button>

                    {/* Numbered List */}
                    <button
                        type="button"
                        className={`note-format-btn ${activeFormats.numbered ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("insertOrderedList")}
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
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("undo")}
                        title="Undo"
                    >
                        <Undo2 size={17} />
                    </button>

                    {/* Redo */}
                    <button
                        type="button"
                        className="note-format-btn"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execCommand("redo")}
                        title="Redo"
                    >
                        <Redo2 size={17} />
                    </button>
                    </div>
                </aside>
                </div>
                <p className="note-copy-feedback" role="status">{copyFeedback}</p>
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
                    <h3 className="notes-gallery-title">All notes</h3>
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
                        <span>New note</span>
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
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Open note: ${displayTitle}`}
                                            onKeyDown={(event) => {
                                                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                                    event.preventDefault();
                                                    onSelectNote(note);
                                                }
                                            }}
                                            onClick={() => onSelectNote(note)}
                                        >
                                            {/* Preview Card Box */}
                                            <div className="note-card-box" data-details={`${displayTitle}\n${sanitizeForPreview(note.content || "").join("\n")}`}>
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
                                                <button type="button" className="note-card-edit-btn" aria-label={`Edit note: ${displayTitle}`} title="Edit note" onClick={(event) => { event.stopPropagation(); onSelectNote(note); }}><SquarePen size={17} /></button>
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

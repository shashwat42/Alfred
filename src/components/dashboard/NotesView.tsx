import { FileText } from "lucide-react";

export function NotesView() {
    return (
        <div className="notes-placeholder-view">
            <div className="notes-placeholder-icon-wrap">
                <FileText className="notes-placeholder-icon" />
            </div>
            <h3 className="notes-placeholder-title">Notes</h3>
            <p className="notes-placeholder-subtext">
                Quick notes, pinned thoughts, and reminders will be available here soon.
            </p>
        </div>
    );
}

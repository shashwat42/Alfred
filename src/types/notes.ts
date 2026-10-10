export interface NoteItem {
    _id: string;
    accountId?: string;
    title: string;
    content: string;
    lastOpenedAt?: string;
    createdAt?: string;
    updatedAt?: string;
}

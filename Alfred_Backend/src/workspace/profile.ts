export interface AccountProfile { name?: string | undefined; picture?: string | null | undefined; updatedAt: string }
export const MAX_PROFILE_PICTURE_LENGTH = 350_000;
export function validProfileName(value: string): boolean {
  return value.trim().length > 0 && value.length <= 100 && !Array.from(value).some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
}
export function validProfilePicture(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_PROFILE_PICTURE_LENGTH &&
    (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) || (() => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } })()));
}

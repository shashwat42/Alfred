import type { Response } from "express";
export class PolicyError extends Error {
    status: number;
    details: Record<string, unknown>;
    constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
        super(message); this.status = status; this.details = { code, ...details };
    }
}
export function sendPolicyError(error: unknown, res: Response): boolean {
    if (!(error instanceof PolicyError)) return false;
    res.status(error.status).json({ error: error.message, ...error.details }); return true;
}

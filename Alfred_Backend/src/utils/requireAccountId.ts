import type { Request, Response } from "express";

export function requireAccountId(req: Request, res: Response): string | null {
    const accountId = (req as Request & { accountId?: string }).accountId;
    if (!accountId) {
        res.status(401).json({ error: "Unauthorized" });
        return null;
    }
    return accountId;
}

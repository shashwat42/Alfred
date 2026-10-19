import type { Request, Response, NextFunction } from "express";
export function requireCloudSync(req: Request, res: Response, next: NextFunction) {
  if (req.account?.cloudSyncEnabled !== true) {
    res.status(409).json({ code: "CLOUD_SYNC_DISABLED", error: "Cloud Sync is disabled. Use the workspace saved on your device." }); return;
  }
  next();
}

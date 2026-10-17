import type { IAccount } from "../models/account.model.ts";

declare global {
    namespace Express {
        interface Request {
            principal?: import("../middleware/auth.middleware.ts").Principal;
            accountId?: string;
            account?: IAccount;
        }
    }
}

export {};

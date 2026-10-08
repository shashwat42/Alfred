import type { IAccount } from "../models/account.model.ts";

declare global {
    namespace Express {
        interface Request {
            accountId?: string;
            account?: IAccount;
        }
    }
}

export {};

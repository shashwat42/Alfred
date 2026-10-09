import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ZodError, z, type ZodType } from "zod";

export const objectIdSchema = z
    .string()
    .trim()
    .refine((val) => mongoose.isValidObjectId(val), {
        message: "Invalid ID format",
    });

export interface ValidationSchemas {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (schemas.params) {
                const validatedParams = (await schemas.params.parseAsync(req.params)) as Record<string, string>;
                try {
                    req.params = validatedParams;
                } catch {
                    Object.defineProperty(req, "params", {
                        value: validatedParams,
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    });
                }
            }

            if (schemas.query) {
                const validatedQuery = await schemas.query.parseAsync(req.query);
                try {
                    req.query = validatedQuery as typeof req.query;
                } catch {
                    Object.defineProperty(req, "query", {
                        value: validatedQuery,
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    });
                }
            }

            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }

            next();
        } catch (err: unknown) {
            if (err instanceof ZodError) {
                const details = err.issues.map((issue) => ({
                    field: issue.path.join(".") || "payload",
                    message: issue.message,
                }));
                const primaryMessage = details[0]?.message || "Validation failed";

                res.status(400).json({
                    error: primaryMessage,
                    details,
                });
                return;
            }
            next(err);
        }
    };
}

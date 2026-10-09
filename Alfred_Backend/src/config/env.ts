import "dotenv/config";

function getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value.trim();
}

function getOptionalEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
        return defaultValue;
    }
    return value.trim();
}

export function parseAllowedOrigins(
    rawOrigins: string | undefined,
    defaultOrigin: string,
    isProd = process.env.NODE_ENV === "production"
): string[] {
    if (rawOrigins && rawOrigins.trim().length > 0) {
        const origins = rawOrigins
            .split(",")
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0);

        if (!origins.includes(defaultOrigin)) {
            origins.push(defaultOrigin);
        }
        return origins;
    }

    // Default origins when ALLOWED_ORIGINS is not explicitly configured
    if (!isProd) {
        // Safe development defaults: web Vite dev server + Tauri local desktop webview origins
        return [defaultOrigin, "http://tauri.localhost", "https://tauri.localhost"];
    }

    // Strict production default: only the explicitly configured frontend URL
    return [defaultOrigin];
}

const frontendUrl = getOptionalEnv("FRONTEND_URL", "http://localhost:5173");
const rawPort = getOptionalEnv("PORT", "8000");
const port = parseInt(rawPort, 10);
if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${rawPort}`);
}

function parsePositiveIntEnv(key: string, defaultValue: number): number {
    const raw = process.env[key];
    if (!raw || raw.trim().length === 0) return defaultValue;
    const parsed = parseInt(raw.trim(), 10);
    if (isNaN(parsed) || parsed <= 0) {
        console.warn(`Invalid positive integer for ${key}: "${raw}". Falling back to default ${defaultValue}.`);
        return defaultValue;
    }
    return parsed;
}

const guestLimitWindowMs = parsePositiveIntEnv("RATE_LIMIT_GUEST_WINDOW_MS", 900000);
const guestLimitMax = parsePositiveIntEnv("RATE_LIMIT_GUEST_MAX", 10);

const authLimitWindowMs = parsePositiveIntEnv("RATE_LIMIT_AUTH_WINDOW_MS", 900000);
const authLimitMax = parsePositiveIntEnv("RATE_LIMIT_AUTH_MAX", 30);

const apiLimitWindowMs = parsePositiveIntEnv("RATE_LIMIT_API_WINDOW_MS", 60000);
const apiLimitMax = parsePositiveIntEnv("RATE_LIMIT_API_MAX", 120);


export const env = {
    port,
    frontendUrl,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS, frontendUrl),
    rateLimit: {
        guest: {
            windowMs: guestLimitWindowMs,
            max: guestLimitMax,
        },
        auth: {
            windowMs: authLimitWindowMs,
            max: authLimitMax,
        },
        api: {
            windowMs: apiLimitWindowMs,
            max: apiLimitMax,
        },
    },
    google: {
        clientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
        callbackUrl: getRequiredEnv("GOOGLE_CALLBACK_URL"),
    },
    mongodb: {
        uri: getRequiredEnv("MONGODB_URI"),
    },
    jwt: {
        secret: getRequiredEnv("JWT_SECRET"),
    },
};

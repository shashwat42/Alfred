import "dotenv/config";

function getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

export const env = {
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
// Secrets are read in-process, never passed as mongosh command-line arguments.
const adminDatabase = db.getSiblingDB("admin");
try {
    if (!adminDatabase.auth(process.env.MONGO_ROOT_USERNAME, process.env.MONGO_ROOT_PASSWORD)) {
        throw new Error("Authentication failed");
    }
} catch {
    throw new Error("MongoDB bootstrap authentication failed; existing data was not modified");
}
load("/scripts/init-replica.js");

// Official Mongo image runs this only for an empty database directory.
// The API receives readWrite on alfred, never root or cluster administration.
// Use in-process env reads rather than the image's jq --arg password bootstrap.
db.getSiblingDB("admin").createUser({
    user: process.env.MONGO_ROOT_USERNAME,
    pwd: process.env.MONGO_ROOT_PASSWORD,
    roles: [{ role: "root", db: "admin" }],
});
const appDatabase = db.getSiblingDB("alfred");
appDatabase.createUser({
    user: process.env.MONGO_APP_USERNAME,
    pwd: process.env.MONGO_APP_PASSWORD,
    roles: [{ role: "readWrite", db: "alfred" }],
});

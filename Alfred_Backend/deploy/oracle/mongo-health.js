// Wait for authenticated final mongod, not the temporary standalone init process.
try {
    const adminDatabase = db.getSiblingDB("admin");
    if (!adminDatabase.auth(process.env.MONGO_ROOT_USERNAME, process.env.MONGO_ROOT_PASSWORD)) quit(1);
    const hello = adminDatabase.adminCommand({ hello: 1 });
    quit(hello.setName === "alfred" || hello.isreplicaset === true ? 0 : 1);
} catch {
    quit(1);
}

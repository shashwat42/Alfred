// Run by mongosh in the one-shot Compose initializer, never by the API.
const replicaSetName = "alfred";

try {
    const status = rs.status();
    if (status.set !== replicaSetName) {
        throw new Error(`Expected replica set ${replicaSetName}, found ${status.set}`);
    }
} catch (error) {
    if (error.code !== 94 && error.codeName !== "NotYetInitialized") {
        throw error;
    }
    const result = rs.initiate({
        _id: replicaSetName,
        members: [{ _id: 0, host: "mongo:27017" }],
    });
    if (!result.ok) throw new Error("MongoDB replica-set initialization failed");
}

// Transactions cannot start until an elected primary is available.
let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
        const hello = db.adminCommand({ hello: 1 });
        if (hello.setName === replicaSetName && hello.isWritablePrimary) {
            ready = true;
            break;
        }
    } catch (error) {
        // The connection may briefly drop while the first election completes.
        if (attempt === 119) throw error;
    }
    sleep(1000);
}

if (!ready) throw new Error("MongoDB replica set did not elect a primary within 120 seconds");
print("Alfred MongoDB replica set is ready");

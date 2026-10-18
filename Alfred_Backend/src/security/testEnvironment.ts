// Imported before backend modules by isolated integration tests. Never use real
// provider credentials or the application's MongoDB URI in this process.
process.env.MODE = "development";
process.env.JWT_SECRET = "isolated-reliability-test-secret-32-chars";
process.env.GOOGLE_CLIENT_ID = "isolated-test";
process.env.GOOGLE_CLIENT_SECRET = "isolated-test";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/auth/callback";
process.env.MONGODB_URI = "mongodb://127.0.0.1/unused_test";
process.env.LLM_API_KEY = "";

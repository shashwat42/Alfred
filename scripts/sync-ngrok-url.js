import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const BACKEND_ENV_PATH = path.join(ROOT_DIR, "Alfred_Backend", ".env");
const DEFAULT_LOCAL_URL = "http://localhost:8000";

/**
 * Queries the ngrok local management API (default: http://127.0.0.1:4040/api/tunnels).
 * Returns the public HTTPS URL if an active tunnel exists, or null.
 */
function fetchNgrokTunnel(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const tunnels = Array.isArray(json?.tunnels) ? json.tunnels : [];
          // Look for an HTTPS tunnel pointing to port 8000 or any backend
          const httpsTunnel = tunnels.find(
            (t) => typeof t.public_url === "string" && t.public_url.startsWith("https://")
          );

          if (!httpsTunnel) {
            return resolve(null);
          }

          // Validate the URL format
          const parsed = new URL(httpsTunnel.public_url);
          if (parsed.protocol === "https:" && parsed.hostname) {
            return resolve(parsed.origin);
          }
          return resolve(null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Updates only GOOGLE_CALLBACK_URL in Alfred_Backend/.env.
 */
function updateBackendCallbackUrl(newBaseUrl) {
  if (!fs.existsSync(BACKEND_ENV_PATH)) return;
  const callbackUrl = `${newBaseUrl}/auth/google/callback`;
  const content = fs.readFileSync(BACKEND_ENV_PATH, "utf-8");
  const lines = content.split(/\r?\n/);
  let updated = false;

  const newLines = lines.map((line) => {
    if (line.match(/^(\s*GOOGLE_CALLBACK_URL\s*=\s*)(.*)$/)) {
      updated = true;
      return `GOOGLE_CALLBACK_URL=${callbackUrl}`;
    }
    return line;
  });

  if (!updated) {
    newLines.push(`GOOGLE_CALLBACK_URL=${callbackUrl}`);
  }

  fs.writeFileSync(BACKEND_ENV_PATH, newLines.join("\n"), "utf-8");
}

/**
 * Updates only VITE_API_BASE_URL in .env, preserving all other keys and comments.
 */
function updateEnvApiUrl(newUrl) {
  let content = "";
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, "utf-8");
  }

  const lines = content.split(/\r?\n/);
  let updated = false;
  let previousUrl = null;

  const newLines = lines.map((line) => {
    const match = line.match(/^(\s*VITE_API_BASE_URL\s*=\s*)(.*)$/);
    if (match) {
      previousUrl = match[2].trim();
      updated = true;
      return `VITE_API_BASE_URL=${newUrl}`;
    }
    return line;
  });

  if (!updated) {
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") {
      newLines.push(`VITE_API_BASE_URL=${newUrl}`);
    } else {
      newLines.splice(newLines.length - 1, 0, `VITE_API_BASE_URL=${newUrl}`);
    }
  }

  fs.writeFileSync(ENV_PATH, newLines.join("\n"), "utf-8");
  updateBackendCallbackUrl(newUrl);
  return { previousUrl, updatedUrl: newUrl };
}


export async function syncNgrokUrl(options = {}) {
  const { reset = false, required = false, quiet = false } = options;

  if (reset) {
    const { previousUrl, updatedUrl } = updateEnvApiUrl(DEFAULT_LOCAL_URL);
    if (!quiet) {
      console.log(`[ngrok-sync] Reset VITE_API_BASE_URL to ${updatedUrl} (was: ${previousUrl || "none"})`);
    }
    return updatedUrl;
  }

  const ngrokUrl = await fetchNgrokTunnel();

  if (ngrokUrl) {
    const { previousUrl, updatedUrl } = updateEnvApiUrl(ngrokUrl);
    if (!quiet) {
      if (previousUrl !== updatedUrl) {
        console.log(`[ngrok-sync] Active ngrok tunnel detected: ${updatedUrl}`);
        console.log(`[ngrok-sync] Updated VITE_API_BASE_URL in .env (was: ${previousUrl || "none"})`);
      } else {
        console.log(`[ngrok-sync] Active ngrok tunnel verified: ${updatedUrl}`);
      }
    }
    return updatedUrl;
  }

  if (required) {
    console.error("[ngrok-sync] Error: Required active ngrok tunnel was not found on http://127.0.0.1:4040.");
    process.exit(1);
  }

  // Fallback to localhost if no active ngrok tunnel is running
  let currentEnvUrl = null;
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, "utf-8");
    const match = content.match(/^VITE_API_BASE_URL\s*=\s*(.*)$/m);
    if (match) currentEnvUrl = match[1].trim();
  }

  const isStaleNgrok = currentEnvUrl && currentEnvUrl.includes("ngrok");
  if (isStaleNgrok) {
    const { updatedUrl } = updateEnvApiUrl(DEFAULT_LOCAL_URL);
    if (!quiet) {
      console.log(`[ngrok-sync] No active ngrok tunnel found. Stale ngrok URL (${currentEnvUrl}) cleaned up.`);
      console.log(`[ngrok-sync] Reverted VITE_API_BASE_URL to default: ${updatedUrl}`);
    }
    return updatedUrl;
  }

  if (!quiet) {
    console.log(`[ngrok-sync] No ngrok tunnel running. VITE_API_BASE_URL using: ${currentEnvUrl || DEFAULT_LOCAL_URL}`);
  }
  return currentEnvUrl || DEFAULT_LOCAL_URL;
}

// CLI invocation handling
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isReset = process.argv.includes("--reset");
  const isRequired = process.argv.includes("--required");
  const isQuiet = process.argv.includes("--quiet");

  syncNgrokUrl({ reset: isReset, required: isRequired, quiet: isQuiet })
    .then((url) => {
      // Exit 0 with resolved url
      process.exit(0);
    })
    .catch((err) => {
      console.error("[ngrok-sync] Unexpected error:", err);
      process.exit(1);
    });
}

import { spawn } from "node:child_process";
import http from "node:http";
import { syncNgrokUrl } from "./sync-ngrok-url.js";

function queryNgrok() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", { timeout: 1500 }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const tunnel = (json?.tunnels || []).find((t) => t.public_url?.startsWith("https://"));
          resolve(tunnel ? tunnel.public_url : null);
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

async function main() {
  const existingUrl = await queryNgrok();
  if (existingUrl) {
    console.log(`[ngrok] An ngrok tunnel is already running at: ${existingUrl}`);
    console.log("[ngrok] Skipping duplicate process creation.");
    await syncNgrokUrl();
    return;
  }

  console.log("[ngrok] Starting ngrok tunnel on port 8000...");
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "cmd.exe" : "ngrok";
  const args = isWindows ? ["/c", "ngrok", "http", "8000"] : ["http", "8000"];

  const proc = spawn(cmd, args, { stdio: "inherit" });

  proc.on("error", (err) => {
    console.error("[ngrok] Failed to launch ngrok. Ensure ngrok is installed and in your PATH:", err.message);
    process.exit(1);
  });

  // Poll for tunnel availability in background to sync .env
  let attempts = 0;
  const pollInterval = setInterval(async () => {
    attempts++;
    const url = await queryNgrok();
    if (url) {
      clearInterval(pollInterval);
      console.log(`\n[ngrok] Tunnel active: ${url}`);
      await syncNgrokUrl();
    } else if (attempts >= 20) {
      clearInterval(pollInterval);
      console.warn("[ngrok] Timed out waiting for tunnel to register with ngrok API.");
    }
  }, 1000);

  const cleanup = () => {
    clearInterval(pollInterval);
    if (!proc.killed) {
      proc.kill();
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("[ngrok] Error:", err);
  process.exit(1);
});

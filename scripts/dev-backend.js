import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { fetchNgrokTunnel, syncNgrokUrl } from "./sync-ngrok-url.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "Alfred_Backend");
const windows = process.platform === "win32";
const docker = windows ? "docker.exe" : "docker";
let tunnelProcess;
let dockerProcess;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  dockerProcess?.kill();
  if (tunnelProcess && tunnelProcess.exitCode === null && tunnelProcess.pid) {
    if (windows) {
      // npm installs ngrok.cmd, whose shell launches Node and the ngrok binary.
      // Terminate only this command's process tree so the tunnel is not orphaned.
      spawnSync("taskkill.exe", ["/PID", String(tunnelProcess.pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true,
      });
    } else tunnelProcess.kill();
  }
  console.log("\n[backend] Stopped this command's ngrok process. The backend container remains running.");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function compose(args) {
  return new Promise((resolve, reject) => {
    dockerProcess = spawn(docker, ["compose", "-f", "compose.yaml", ...args], {
      cwd: backend,
      stdio: "inherit",
      // Always run development policy on the port used by ngrok and URL sync.
      env: { ...process.env, DOCKER_MODE: "development", DOCKER_API_PORT: "8000" },
      windowsHide: true,
    });
    dockerProcess.once("error", () => reject(new Error("Cannot start Docker. Install Docker Desktop and start its Linux engine.")));
    dockerProcess.once("exit", (code) => {
      dockerProcess = undefined;
      if (code === 0) resolve();
      else reject(new Error("Docker Compose failed. Check the output above and that Docker Desktop is running."));
    });
  });
}

async function ensureTunnel() {
  const existing = await fetchNgrokTunnel();
  if (existing) {
    console.log("[ngrok] Reusing the existing HTTPS tunnel to localhost:8000.");
    return;
  }
  console.log("[ngrok] Starting an HTTPS tunnel to localhost:8000...");
  // cmd resolves both an npm ngrok.cmd shim and a native ngrok.exe on PATH.
  // This command is constant; no configuration or user input enters the shell.
  tunnelProcess = spawn(windows ? "cmd.exe" : "ngrok", windows ? ["/d", "/s", "/c", "ngrok http 8000"] : ["http", "8000"], {
    cwd: root, stdio: "inherit", windowsHide: true,
  });
  let failed = false;
  tunnelProcess.once("error", (error) => {
    failed = true;
    console.error(`[ngrok] Could not launch the command (${error.code ?? "spawn error"}). Check ngrok on PATH.`);
  });
  tunnelProcess.once("exit", () => {
    failed = true;
    if (!stopping) {
      console.error("[ngrok] Tunnel stopped. Run npm run dev:backend to reconnect.");
      stop();
      process.exitCode = 1;
    }
  });
  for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
    if (failed) throw new Error("ngrok could not start. Check its installation, authentication, and output above.");
    if (await fetchNgrokTunnel()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("No HTTPS tunnel to localhost:8000 became available on ngrok's local API (port 4040).");
}

async function main() {
  const envPath = path.join(backend, ".env");
  if (!fs.existsSync(envPath)) throw new Error("Configure Alfred_Backend/.env with your Atlas URI and backend credentials first.");
  const require = createRequire(path.join(backend, "package.json"));
  const config = require("dotenv").parse(fs.readFileSync(envPath));
  let atlas = false;
  try {
    const uri = new URL(config.MONGODB_URI);
    atlas = uri.protocol === "mongodb+srv:" && uri.hostname.endsWith(".mongodb.net") && uri.pathname === "/alfred";
  } catch { /* Never include credentials in validation errors. */ }
  if (!atlas) throw new Error("Set MONGODB_URI in Alfred_Backend/.env to your Atlas SRV connection string with database /alfred.");

  await compose(["config", "--quiet"]);
  if (stopping) return;
  await ensureTunnel();
  if (stopping) return;
  // Save the public API and Google callback URLs before Docker reads the env file.
  const publicUrl = await syncNgrokUrl({ required: true });
  if (stopping) return;
  await compose(["up", "-d", "--build", "--force-recreate", "--wait", "--wait-timeout", "180", "backend"]);
  if (stopping) return;
  console.log(`[backend] Ready in development mode using Atlas. Public API: ${publicUrl}`);
  console.log("[backend] Google Cloud must allow this exact redirect URI:");
  console.log(`${publicUrl}/auth/google/callback`);
  console.log("[backend] Stop the container separately with: docker compose -f Alfred_Backend/compose.yaml stop backend");
  // Keep the command available for Ctrl+C even when reusing an existing tunnel.
  while (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
}

main().catch((error) => {
  if (!stopping) console.error(`[backend] ${error.message}`);
  const interrupted = stopping;
  stop();
  process.exitCode = interrupted ? (process.exitCode ?? 0) : 1;
});

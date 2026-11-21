import { checkReleaseVersions } from "./release-config.js";

try {
  console.log(`Android, Linux, Windows and backend release version: ${checkReleaseVersions()}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

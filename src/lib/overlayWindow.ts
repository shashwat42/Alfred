import { isTauri } from "../auth/auth.ts";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Positions the overlay window horizontally centered and near the top of the screen.
 */
export async function positionOverlayAtTop(): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWebviewWindow();
      const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (monitor) {
        const outerSize = await win.outerSize();
        const screenWidth = monitor.size.width;
        const screenX = monitor.position.x;
        const screenY = monitor.position.y;
        const targetX = screenX + Math.round((screenWidth - outerSize.width) / 2);
        const targetY = screenY + 8; // Anchored near very top of monitor
        await win.setPosition(new PhysicalPosition(targetX, targetY));
      }
    } catch (e) {
      console.warn("Failed to position overlay at top:", e);
    }
  }
}


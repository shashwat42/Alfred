# Account settings and UI update

Changes are implemented in the workspace. Frontend, backend, and native changes should ship together; the new preference API must be available for cross-device synchronization.

## Behavior

- Voice pause, overlay mode, sidebar state, and Windows startup preferences belong to the signed-in account. Cloud Sync shares them across devices; offline edits remain pending until reconnection. Existing reminder destinations and Cloud Sync remain account scoped. OS permission grants retain their actual device status.
- Legacy device preferences migrate once to the first account that opens them, preventing a second account from inheriting them.
- Photos accept PNG/JPEG/WebP sources up to 8 MB, crop to 512 × 512, and encode as JPEG with a 200 KB ceiling. Oversized results retry compression; failures leave the existing photo intact.
- The dashboard refresh also reloads profile information, account usage, and preferences. Mobile assistant refresh uses the same coordinator. The separate usage refresh button was removed.
- Settings use switches for boolean preferences, tighter spacing, and expandable profile editing and secondary help. Cloud Sync explains its cross-platform purpose. Android can choose Quick Input or Voice.
- Android assistant setup can be attempted when its status lookup fails, and settings launch runs on the Android UI thread.
- Android Back first dismisses the keyboard, then dialogs/editors/focus view, then navigates through viewed screens. At the root it returns to or remains on Dashboard.
- Notes save before navigation; a failed save keeps the editor open. The mobile navbar stays hidden while editing. Formatting starts collapsed, preserves text selection, has a plain-text copy action, and uses a transparent background. Previews show three lines with line breaks.
- Focus and date controls are inside Dashboard content. Android omits the branding header and accounts for keyboard and system insets. The welcome screen uses compact layouts on smaller phones.
- Long press reveals existing control descriptions and item details; keyboard users can reveal them through focus. Empty tasks, notes, and schedules have visual cues.
- Overlay logos remain static. Microphone waveform heights use measured input levels instead of a repeating animation. Desktop windows position before their initial reveal; Android reveals the assistant WebView after layout. Opening transitions respect reduced motion.
- Offline and server-unavailable dialogs offer retry and access to saved content without unmounting drafts. Cached cloud reads remain available during outages; cloud writes are not silently saved as local-only edits. The existing 404 view is verified. Shared loading indicators use the tuxedo button animation.

## Verification

All application testing used `MODE=development`.

- Frontend tests cover account isolation, legacy preference migration, concurrent synchronization, account switching, cached cloud reads during outages, and multiline rich-text extraction.
- Backend account integration suite: 10 passed against a temporary MongoDB replica set, with the suite's existing stub AI provider.
- Profile UI: passed, including compression retry, 512 px output dimensions, removal, and account isolation.
- Workspace UI: passed for collapsed formatting, multiline copying/previews, failed-save protection, tutorial return, offline/server recovery, preserved drafts, and 404.
- Assistant controls UI: passed for mode switching, microphone controls, conversation preservation, and startup failures.
- Overlay lifecycle UI: passed for StrictMode cleanup, hide/summon, clearing conversations, cancellation, idle expiry, switching modes, and Escape.
- Frontend/backend TypeScript checks, changed frontend source lint, and the development build passed.
- Android assistant debug compilation, Android app debug Kotlin compilation, and assistant JVM unit tests passed. No production assets were rebuilt for these native checks.
- Browser review checked the welcome screen at 320 × 568 without scrolling; dashboard, compact settings, the collapsed/expanded note toolbar, hidden/restored note navbar, multiline previews, and screen-history Back behavior in an isolated Android UI fixture; and the desktop dashboard at 1280 × 800. The temporary fixture used stub responses and separate browser storage and was removed afterward.

## Remaining manual review

No Android device or emulator is connected to ADB. Verify the assistant chooser, native Back gestures, keyboard insets, microphone waveform sensitivity, and opening transitions on actual devices. Check the global loader and native animation timing with real startup and network delays.

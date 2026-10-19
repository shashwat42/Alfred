# Local storage and Cloud Sync

New installations keep tasks, notes and schedules in an account-scoped IndexedDB
workspace on the device. Creating, reading, editing and deleting this content does
not call the content API or save it in MongoDB Atlas. Reloading the app and signing
out preserve the device copy. Local storage has no Alfred cloud quota, but remains
subject to available device/browser storage. Clearing app data or uninstalling can
remove it. Accounts on the same device have separate workspaces.

Settings → **Cloud storage → Cloud Sync** is off by default on each device.
Enabling it explicitly merges the device workspace with existing cloud content
(the newer version of a matching record wins) and uploads it atomically. Cloud
storage quotas apply to this upload and subsequent cloud writes. A failed upload
does not enable sync or remove the device copy. Cloud mode requires internet for
changes; successful cloud reads and changes also update the device copy.

Turning sync off first downloads and durably saves the cloud workspace, then
removes the account's cloud tasks, notes, schedules and notification registrations
in a transaction. A revision fence prevents clearing content changed by another
device after the download. This affects the whole account's cloud workspace.
Other devices retain their saved copies and return to local mode when the server
reports that Cloud Sync is disabled. Existing installations' cloud content is
preserved until the user enables sync or selects **Move existing cloud data to
this device**. No automatic production data deletion or migration is performed.

Google sign-in copies a guest's local workspace to the signed-in account on the
same device, preserving the source for recovery; it does not enable cloud uploads.
Account deletion removes that account's current device workspace and its linked
guest recovery copies, as well as its server records. Unrelated signed-out or
inaccessible guest copies are not erased implicitly.

AI still requires the backend and a provider connection. In local mode the current
workspace accompanies the request, tools operate on request-scoped memory, and the
result is saved back to the originating device. Content is not persisted to Atlas.
An account or workspace change during the request prevents stale actions from
overwriting newer data. AI quota and request-id records remain server-side and do
not contain message text, audio or workspace content. Provider processing and
retention remain separate from Alfred's persistence choice.

Cloud reminder delivery, including Android background alarms and push, requires
Cloud Sync. Local mode does not register notification devices or upload reminder
preferences. The settings explain this limitation instead of silently uploading
schedules. Desktop and Android assistant documents share their device's account
workspace; cross-document invalidation refreshes foreground lists.

Atlas still holds account/Google or guest identifiers, session/security state,
onboarding and the Cloud Sync flag, and AI usage metadata needed for sign-in and
quota enforcement. New Google accounts no longer persist name, email or picture
fields. Older profile metadata is not silently purged. “Cloud storage” labels refer
to the existing content quota; this is not a claim that the entire Atlas database
contains only a single account-ID field.

Validate with `MODE=development`: `npm test`, `npm run lint`,
`npm --prefix Alfred_Backend run check`, `npm --prefix Alfred_Backend test`,
`node scripts/verify-storage-ui.ts` and `npm run build:development`.
Integration tests use temporary MongoDB replica sets, fake IndexedDB and stub
providers, never the normal application database.

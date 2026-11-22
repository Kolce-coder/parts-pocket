# Parts Pocket

A small personal inventory app for iPhone and laptop. Track nested locations, item names, search tags, placement notes and quantities. Search ignores capitals and matches any word, including valve/rocker cover aliases. Transfer one or several items to an existing or new location. Reducing a quantity to zero asks before deleting.

Open https://kolce-coder.github.io/parts-pocket/ . On iPhone, open in Safari and use Share > Add to Home Screen. On a laptop, use the same address in your browser (or install it from your browser's app menu). Open the installed app before connecting your inventory.

## Private sync using GitHub

The app code is public; inventory.json lives in the separate PRIVATE Kolce-coder/parts-pocket-data repository. No Supabase, photo storage, paid database, analytics, or external runtime libraries are used. This uses GitHub's current Free plan, not a paid subscription. GitHub's own service limits and future terms still apply.

In Sync & backup, connect using a fine-grained GitHub personal access token. Give it access ONLY to parts-pocket-data, with Contents read and write permission. The access key is kept in this browser and sent only to api.github.com. Do not post it in chat, a repository, or a backup. Repeat connection on each phone/laptop. If the key expires, create a replacement and use Reconnect; no payment is needed.

The connected inventory opens offline. Edits save on the device, then sync after changes, when the app returns to the foreground, on reconnect, and about every 30 seconds while open. Wait for Synced across devices before switching devices. When offline, the other device will not receive changes yet. Keep the app open until syncing finishes; iPhone background execution is not guaranteed.

Independent edits merge. Competing quantity edits require you to enter the actual remaining count; matching numbers can still represent two separate adjustments. Other conflicts let you choose which complete copy to use, and keep recovery copies on that device. A missing or rolled-back GitHub file never clears your local inventory; restore it from GitHub's file history before syncing again.

Connecting does not silently upload a separate device-only inventory. When the connected inventory is empty, use Copy this device's local inventory into my account. Disconnect removes the access key and returns to the separate local inventory. Offline inventory caches remain on the device. Protect your device/browser profile, and back up before clearing browser data or removing the app.

## Backups and photos

Prepare backup creates one JSON file with all items, locations, notes and quantities. Download/save that file separately. Restore replaces the current inventory and, when connected, syncs that replacement to the other devices. Photos are not supported: there are no camera or image controls, photos are not uploaded, and old backup photos are not imported. Existing images from an older local version are left alone until their records are explicitly removed or the inventory is restored.

## Portable computer copy

The downloadable full package includes Parts Pocket.html. Open it directly for a self-contained local inventory with no installation. Its inventory is separate from the hosted app, and it does not sync. Use Backup/Restore to move data. For automatic phone/laptop syncing, use the hosted address above.

## Updating / development

GitHub Pages serves main / (root), with .nojekyll. Keep the same site address to retain access to browser data. Close and reopen the app after an update so its service worker can switch versions.

Source and tests are in the full download. Run npm ci, npm test, npm run build, and node verify-package.mjs. Tests cover hierarchy, search, quantities, transfers, local revision checks, account isolation, GitHub requests, offline changes, sync conflicts, request retries and recovery. Browser checks cover the phone layout and inventory controls. Physical iPhone installation and each real device's connection require user setup.

# Parts Pocket

A personal inventory app for parts and other belongings. It supports nested locations, photos of items and locations, case-insensitive search, quantities, and individual or bulk transfers.

Open the published app in Safari on iPhone, then use Share > Add to Home Screen. Open it from the new icon before entering or restoring your inventory. After the first complete load, it can work offline.

All inventory records and photos are stored in the current browser/device. They are not uploaded to GitHub and do not automatically sync between devices. Use Backup to save a JSON file containing every item, location and photo. Keep a separate copy before clearing browser data or removing the app. Restore replaces the current inventory.

## Hosting

These files are ready for GitHub Pages. In repository Settings > Pages, choose Deploy from a branch, main, and /(root). No build command or server is needed. Use the final HTTPS address shown by GitHub.

## Updating

Keep the same site address to retain access to stored data. Update the service-worker cache version whenever app files change, then close and reopen the app to activate the new version. Back up before updating.

The app does not include any example inventory or personal photos. Built with standard HTML, CSS, JavaScript, IndexedDB and a service worker. No third-party runtime dependencies.

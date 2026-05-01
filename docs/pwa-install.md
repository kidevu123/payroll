# PWA install — owner verification

The employee app installs as a home-screen PWA on iPhone Safari and Android
Chrome. v1.2 wires:

- `app/manifest.ts` → served at `/manifest.webmanifest`
- `start_url`: `/me/home`
- `display`: `standalone`
- `theme_color`: live brand color (Settings → Branding); also exported as
  the static metadata default (`#0f766e`) so the OS install dialog has
  something before first paint
- Icons: `/api/branding/icon/{192,512,maskable-512}` (PNG when sharp has
  written from the uploaded logo, falls back to a brand-colored initials
  SVG until then)
- Service worker: `/public/sw.js` — caches the offline shell only

## Owner verification steps

The dev container can't install on a real phone, so verify by hand:

### iPhone Safari

1. Open `https://digitz.duckdns.org/me/home` in Safari.
2. Tap the share icon → **Add to Home Screen**.
3. Confirm:
   - The icon previewed in the sheet shows the company logo (or initials
     on the brand color if no logo uploaded).
   - The displayed title matches `Settings → Company → name`.
4. Tap the new home-screen icon. The app should launch in standalone mode
   (no Safari URL bar). The status bar tint should match the brand color.

### Android Chrome

1. Open `https://digitz.duckdns.org/me/home` in Chrome.
2. Open the menu → **Install app** (or Chrome may prompt automatically).
3. Confirm the icon + name in the install dialog.
4. Open the installed app from the launcher; standalone mode should be on.

### Re-checking after a logo update

Both OSes cache the icon. After uploading a new logo in
`Settings → Branding`:

1. Click **Regenerate PWA icons** in the same tab.
2. On the phone: long-press the home-screen icon, remove it, then re-add.
   (iOS in particular won't refresh the icon while installed.)

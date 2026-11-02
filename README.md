# Mango Ville bookings

Calendar booking app. SQLite (sql.js) runs on the phone; data lives on the device only.

## Get it on an iPhone (no Mac, no hosting)
1. Push this folder as its own GitHub repo (private is fine). GitHub Actions builds `MangoVille.ipa` (Actions tab → latest run → Artifacts → MangoVille-ipa).
2. Download it, then install with **Sideloadly** (Windows, sideloadly.io) using your free Apple ID, iPhone connected by USB.
3. On the iPhone: Settings → Privacy & Security → Developer Mode on; Settings → General → VPN & Device Management → trust your Apple ID.
Free Apple IDs expire apps after 7 days: re-run Sideloadly weekly (data is kept if you install over the existing app). Paid dev account ($99/yr) lifts this.

Back up often: Summary → "Back up data (.sqlite)". Import old Excel data via "Restore / import".
Local test: `python -m http.server 3100` in this folder.

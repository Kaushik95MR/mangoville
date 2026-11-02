# Mango Ville

Native SwiftUI iPhone app (iOS 17+) for villa bookings: calendar, expenses, monthly summary.
The app starts with the Excel history bundled as `MangoVille/seed.sqlite` (guest names and phone numbers — keep this repo private). Data lives in a SQLite file on the phone (`Application Support/mango-ville.sqlite`). No server, no account.

- `MangoVille/` — the app (SwiftUI + the system SQLite, no dependencies). `project.yml` is the XcodeGen project spec.
- `web/` — the earlier browser version, kept for reference (`python -m http.server` inside it).

## Install without a Mac
1. Push to GitHub; Actions builds `MangoVille.ipa` (Actions → latest run → Artifacts).
2. Install it with Sideloadly (Windows) using your Apple ID. Enable Developer Mode on the phone and trust the profile.
Free Apple IDs expire apps after 7 days; reinstall over the top to keep data.

Back up from Summary → Back up data. Restore accepts the `.sqlite` file (including `mango-ville-import.sqlite` converted from the Excel sheet).

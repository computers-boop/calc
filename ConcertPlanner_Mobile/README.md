# Concert Planner Mobile — Android, iPhone, and iPad

A redesigned, mobile-first concert planner based on the existing Python/Tkinter **ConcertPlanner_Stage_Icon_Edition.py**. This project is JavaScript/HTML/CSS with a Capacitor wrapper for building native Android and iOS apps. It also runs as an installable Progressive Web App (PWA). No UI framework or cloud account is required to run the app in a browser.

## What is included

- Five large, finger-friendly navigation tabs: **Plan**, **Budget**, **Results**, **Research**, **Library**.
- Headliner, city, capacity, low/base/high attendance scenarios, support artists with fees.
- Every **17 original budget fields**, sponsor and bar income, deposit/rights, tax and ticket fees, profit target, contingency, ticket-price scenarios.
- Current desktop JSON-compatible saved calculation files, local saved history (up to 100), import/export, comparisons of two plans, and document file selection.
- Multi-provider research from Wikipedia, Wikimedia pageviews, MusicBrainz, DuckDuckGo, Bing RSS, Google News RSS, and optional Last.fm/Ticketmaster APIs. Research shows provider status and source links. Results can be exported as a text report.
- Minimalist stage icon and **Midnight & Copper** palette.
- Responsive phone/tablet layouts, iOS safe-area spacing, and an offline cached UI.

## Quick preview on any computer

Use Python 3 to serve the app from the project directory:

```sh
python3 -m http.server 8080 -d www
```

Open `http://localhost:8080` in a browser. Set the browser viewport to phone width to see the mobile layout.

Open the preview on a physical phone via a local HTTPS/tunnel service or host the `www/` folder on an HTTPS site. A `file://` opened from storage may not load JavaScript modules and is not suitable for the PWA.

## Install as a home-screen web app

1. Publish `www/` to a web server using **HTTPS**.
2. **Android:** open the HTTPS site in Chrome and choose **Install app** / **Add to Home screen**.
3. **iPhone/iPad:** open it in Safari → Share → **Add to Home Screen**.

Budget, calculations and saved history work offline after the app shell has loaded. Internet research requires a connection. Some search providers restrict browser cross-origin access, so the native Android/iOS wrapper is recommended for the best chance of working search access; no provider guarantees complete search results.

## Build a native Android app (APK/AAB)

Requirements: Node.js 22+, Android Studio with Android SDK, and Java environment configured by Android Studio.

```sh
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Then use Android Studio's Run or Build menu to create an APK, or create a signed AAB for Google Play. After modifying the `www/` files, run `npx cap sync android` again.

## Build a native iOS app (iPhone/iPad)

**Requires a Mac with Xcode and an Apple developer signing setup** (Capacitor 8 requires Xcode 26+). On that Mac:

```sh
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Set up signing and device in Xcode, then Run or Archive for distribution. After changes, sync again. You cannot produce a signed iOS IPA using only this ZIP on Windows/Linux.

Capacitor native builds have `CapacitorHttp.enabled=true` in `capacitor.config.json`, allowing supported `fetch` requests to use native HTTP and avoid browser-only CORS restrictions. Remote websites and APIs can still block, rate-limit or change their responses.

Change `appId` in `capacitor.config.json` to an identifier you control before publishing to an app store. The platform icons should be regenerated from `www/icons/stage-512.png` when preparing releases.

## Saved files and privacy

The application stores plans **locally in the browser's/WebView's localStorage**, not on an online account; clearing app/site data removes saved plans. Export JSON backups regularly, especially before switching devices. Imported desktop files use the original keys, including `support_artists: [{name, fee}]`. Currency is a **display unit only**; changing from EUR to USD does not convert entered values.

TXT/CSV files can be previewed. PDF, XLSX and DOCX can be selected as references but their contents are not parsed, matching the desktop program's limitation. Files themselves are not uploaded to a server.

Last.fm and Ticketmaster API keys are optional, kept only in memory for the current session, and are never saved in calculation JSON. For an app-store release used by others, secret provider credentials should be handled by a secure server rather than embedded into a client app.

### Research caveats

The planner reports independent sources when reachable and exposes failed providers. Public attention stats, keyword hits, event listings, announced capacities and automatically extracted number clues are **not** verified ticket sales. It does not overwrite attendance percentages unless the user explicitly applies a suggested scenario, and it generates a suggestion only when multiple distinct domains contain numerical local clues. Verify citations manually before committing to an event budget.

### Financial-model note

To match the supplied Python calculator, an artist deposit is modeled as an *additional cost* on top of the headliner fee, rather than an advance payment against the fee. Adjust this if your actual contracts handle deposits differently.

## Tests

```sh
npm test
```

Tests cover original budget fields, support acts, cost and ticket formulas, desktop JSON compatibility, invalid inputs, and research report formatting. Browser-based navigation and mobile viewport checks should also be run before store distribution.

## Limitations of this delivery

This ZIP is a functioning web/PWA application **and native-ready source project**, not a precompiled Android APK or iOS IPA. Native store packages require Android Studio / Xcode and code signing. Search APIs may restrict access; live research was not available to verify in the build environment.

# 404 Name not Found (`/nnf/`)

A real-time, anonymous message board / imageboard built on Firebase (Firestore + Hosting + Cloud Functions).

🔗 Live site: https://404-nnf.web.app

## Features

- **Anonymous, real-time feed** — no accounts or sign-up, messages appear instantly for everyone (Firestore `onSnapshot`)
- **Sequential post numbers** (`#1`, `#2`, ...) — every message gets a permanent `seq` number
- **Reply system** — reference another post with `>>123`, click it to jump to that post; a "Reply" button inserts it automatically
- **Hover preview** — hovering over a `>>123` link shows a preview of that post's content
- **Greentext** — lines starting with `>` are colored green, classic imageboard style
- **Pagination** — First/Last page, Next/Prev, jump directly to any page number, total page count shown
- **Site-wide search** — searches message text live (debounced, with a capped scan size)
- **Two layout modes** — Classic (forum-style, newest on top) / Chat (newest at the bottom, composer pinned below)
- **Dark / light theme**
- **Desktop notifications** — while the tab is in the background, a new post badges the favicon, updates the title with a count, and (if permission is granted) shows a browser notification
- **Telegram bot integration** — a Cloud Function (`functions/index.js`) pings a Telegram chat/group whenever a new message is posted
- **Built with data usage in mind** — pagination, a capped search scan, and a visibility-aware listener keep Firestore read/write costs low

## Tech stack

- Plain HTML / CSS / JavaScript — no framework, no build step
- Firebase Firestore (database)
- Firebase Hosting (static hosting)
- Firebase Cloud Functions — 2nd gen (for the Telegram notification)

## Setup

```bash
git clone https://github.com/SeyfKarahan/4chanV2.git
cd 4chanV2
npm install
cd functions && npm install && cd ..
```

Fill in your own Firebase project details in `public/firebase-config.js` (Firebase Console → Project settings → Web app).

Add your Telegram bot info to `functions/.env`:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Deploy

```bash
firebase deploy --only hosting:404-nnf
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Project structure

```
4chanV2/
├── public/              # site files (index.html, app.js, style.css, firebase-config.js)
├── functions/           # Cloud Function for Telegram notifications
├── firestore.rules       # database security rules
├── firebase.json         # Firebase Hosting/Functions/Firestore config
└── .firebaserc            # Firebase project alias mapping
```

## Notes

- Messages can't be deleted or edited (`firestore.rules` blocks this) — by design, for an anonymous feed.
- No IP address or location data is logged.
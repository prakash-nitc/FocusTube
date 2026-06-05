# FocusTube 🎯

A Chrome extension that transforms YouTube into a distraction-free learning environment — hide recommendations, track study sessions, and stay focused.

## What is FocusTube?

Unlike traditional website blockers, FocusTube doesn't block YouTube entirely. Instead, it understands your study intent and actively reduces opportunities for distraction while preserving educational content.

> **Core principle:** Prevent impulsive context-switching without restricting legitimate learning.

## Features

- **Study Mode** — Start a session on any YouTube lecture. The extension keeps you focused on your study material.
- **YouTube Clean Room** — Hides distracting elements: homepage feed, shorts shelf, sidebar, recommendations, comments, and end-screen cards.
- **Intent Confirmation** — When you click an unrelated video, a modal asks you to confirm before navigating away.
- **Keyword-Based Relevance** — Automatically detects if a destination video is related to your study topic.
- **Distraction Recovery** — Reminds you to return to your lecture if you've been away too long.
- **Break Timer & Pomodoro** — Take intentional breaks with built-in timers (5/10/15 min or Pomodoro presets).
- **Session Dashboard** — Track study time, focus score, distraction attempts, and weekly progress.
- **Focus Score** — `(Study Time / Total Session Time) × 100` — see how focused you really are.
- **Session Goals** — Set a goal before each session and track completion.
- **Emergency Unlock** — Need YouTube temporarily? Type a confirmation phrase to unlock for 10 minutes.

## Tech Stack

- Chrome Extension (Manifest V3)
- Vanilla JavaScript (ES Modules)
- Vanilla CSS
- Chrome Storage API
- No external dependencies

## Project Structure

```
FocusTube/
├── manifest.json
├── src/
│   ├── background/         # Service worker (session, alarms, navigation)
│   ├── content/            # Content scripts injected into YouTube
│   ├── popup/              # Extension popup UI
│   ├── dashboard/          # Full-page session dashboard
│   ├── options/            # Extension settings page
│   └── shared/             # Constants, storage layer, utilities
├── assets/
│   └── icons/              # Extension icons
└── README.md
```

## Installation (Development)

1. Clone the repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** and select the `FocusTube` folder
5. Navigate to YouTube and start a study session!

## License

MIT

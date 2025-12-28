# Patreon Timestamp Preserver

Chrome extension that auto-saves your playback position on Patreon VODs and tracks your watch history.

<img width="354" height="390" alt="image" src="https://github.com/user-attachments/assets/fa13e39d-a24e-4acc-9427-666a4ce45675" />

## Features

- **Auto-save** - Saves your position every 15 seconds while watching
- **Auto-restore** - Resumes playback when you return to a video
- **Watch history** - Popup shows all tracked videos with progress bars
- **Metadata tracking** - Captures video title, creator name, and post date
- **Progress tabs** - Separate "In Progress" and "Completed" sections
- **Mark complete** - Videos at 95%+ are auto-marked as completed

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `timestamps-preserver` folder

## Usage

1. Navigate to any Patreon post with a video
2. Start watching - the extension automatically tracks your position
3. Close the tab whenever you want
4. Return later - your position is restored with a toast notification
5. Click the extension icon to see your watch history

## Privacy

All data is stored locally in your browser using Chrome's storage API. No data is sent to external servers.

## License

MIT

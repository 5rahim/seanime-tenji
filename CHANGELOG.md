# Changelog

All notable changes to this project will be documented in this file.

## v0.2.0

- ⚡️ UI: Handling of larger screen sizes
- ⚡️ Player(Android): Use gpu-next for hardware decoding by default
- ⚡️ Player(Android): Support for mpvEX
- ⚡️ Playback: Support watching downloaded episodes in external player
- ⚡️ Player(iOS): Pause playback when phone locks
- ⚡️ Torrent streaming: Preload next episode when enabled
- ⚡️ Debrid streaming: Show cached torrent indicator
- ⚡️ Discover: Aired Recently section
- ⚡️ Schedule: Missing and upcoming episodes
- ⚡️ Search: Tag and minimum score filters
- ⚡️ My List: Tag filters
- 🦺 Download: Handling of episodes with multiple files
- 🦺 Playback: Fixed continuity updates using stale progress
- 🦺 Settings: Refresh app data when server settings change
- 🦺 Discover: Fixed sections loading the wrong data
- 🦺 UI: Restrict anime entry bottom bar width on larger screens
- 🦺 Core: Added cancellation and timeout handling
- 🦺 Core: Refactored websocket handling

## v0.1.21

- ⚡️ Refactored support for mobile server downloads
- ⚡️ Android: Trust local certs
- 🦺 iOS: Potential fix for orientation restoration issues

### OTA (6/23):

- 🦺 Bypass offline mode check when changing server url
- 🦺 Player: Fixed double tap backward seek #10

## v0.1.20

- 🎉 Alpha release

### OTA (6/10):

- ⚡️ Player: Option to disable subtitles
- ⚡️ Torrent search: Support for search across providers
- ⚡️ Torrent search: Redesigned layout and smart search params
- ⚡️ Manga: Improved zooming handling
- 🦺 Local Manga: Fixed cache pollution causing incorrect chapters being shown
- 🦺 Android: Use stepper instead of slider for score
- 🦺 Logs: Fixed log entry size causing crashes
- 🦺 Player: Fixed overlays being stuck
- 🦺 Player: Fixed persistent homebar indicator on iOS
- 🦺 Home: Fixed part of the library not showing up when switching off offline mode

### OTA:

- ⚡️ Manga: Double tap to zoom in/out
- 🦺 Auth: Bypass status check when switching to offline mode
- 🦺 iOS: Fixed websocket issues causing stream starts to fail
- 🦺 Android: Add dynamic safe insets to navbar

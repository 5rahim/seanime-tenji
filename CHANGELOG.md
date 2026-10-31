# Changelog

All notable changes to this project will be documented in this file.

## v0.4.0

- ⚡️ TV: Added Discover and Settings shortcuts to the empty library screen
- 🦺 Player(Android TV): Fixed controls and dialogs hidden behind video
- 🦺 Player(Android TV): Fixed playback getting stuck after quick seeks
- 🦺 Player(Android): Fixed https streams failing to open
- 🦺 Player(Android): Fixed black screen when resuming playback
- 🦺 Player(tvOS): Fixed crash when playing AV1 files
- 🦺 Player(TV): Fixed Play and Pause buttons on the remote
- 🦺 Player: Fixed the app freezing when a video stalls
- 🦺 Player: Fixed stream request headers containing commas
- 🦺 Player: Fixed preferred subtitle language not applying to subtitles added after the video loads
- 🦺 Player: Fixed Up next countdown cancelling at the end of an episode
- 🦺 Playback: Fixed episodes marked as watched when a stream fails
- 🦺 Download: Fixed batch torrents starting a stream instead of downloading
- 🦺 Server: Fixed getting sent back to the setup screen after connecting
- 🦺 TV: Fixed focus getting lost after leaving a text field
- 🦺 Android: Fixed navigation bar scrim
- ⬆️ Player(Android): Upgraded mpv
- ⬆️ Upgraded to React Native 0.88 / Expo SDK 58

## v0.3.0

- 🎉 New Releases: AndroidTV and tvOS
- ⚡️ Player: Buffered progress in seek bar
- ⚡️ Player (Android): SubRip subtitles now get a usable fallback font
- ⚡️ Player: Playback stats
- ⬆️ Upgraded to React Native 0.85 / Expo SDK 56

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

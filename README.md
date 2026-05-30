<p align="center">
<a href="https://seanime.app/">
<img src="src/assets/images/logo_2.png" alt="preview" width="70px"/>
</a>
</p>

<h1 align="center"><b>Seanime Tenji</b></h1>

<p align="center">
<img src="https://seanime.app/bucket/img-20260530-115604-bh3pofrz--sq2.webp" alt="preview" width="100%"/>
</p>

<p align="center">
  <a href="https://seanime.app/docs">Documentation</a> |
  <a href="https://github.com/5rahim/seanime-tenji-releases/releases">Latest release</a> |
  <a href="https://discord.gg/Sbr7Phzt6m">Discord</a> |
  <a href="https://seanime.app/docs/policies">Copyright</a>
</p>

<div align="center">
  <a href="https://github.com/sponsors/5rahim">
    <img src="https://img.shields.io/static/v1?label=Sponsor&style=flat-square&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86" alt="" />
  </a>
</div>


<h5 align="center">
Leave a star if you like the project! ⭐️
</h5>

## About

Seanime Tenji is a **companion app** to your Seanime media server with a **built-in player** and **offline support** for streaming anime and reading manga.

> [!IMPORTANT]
> Seanime & Seanime Tenji do not provide, host, or distribute any media content. Users are responsible for obtaining media through legal means and complying with their local laws. </strong>

## Features

- **Cross-platform**: Available on iOS and Android
- **Built-in media player**: Powered by libmpv, supports most anime codecs and formats
- **Playback Options**: Support for server local files, torrent, debrid and online streaming
- **Manga Reader**: Read and download chapters
- **Download locally**: Download anime episodes and manga chapters to your device
- **External Player Support**: Support for opening media in external players such as VLC, MX Player, Outplayer, etc.
- **Offline Mode**: Access your downloaded anime episodes and manga chapters without an internet connection

## Development

Seanime Tenji is built with React Native and Expo. Detailed guides on setup and local development workflows can be found in the [Contributing Guide](CONTRIBUTING.md).

### Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Metro Bundler**:
   ```bash
   npm run dev:start
   ```

3. **Run on Emulator / Simulator**:
	* **Android**:
	  ```bash
	  npx expo run:android
	  ```
	* **iOS**:
	  ```bash
	  npm run dev:ios
	  ```

### Local Build & Development Notes

When building and testing Seanime Tenji locally, keep these integration requirements in mind:

* **Physical iOS Devices & Signing**: To test on a physical iOS device, configure your Apple Developer Team ID inside a `.env.local` file at the root:
  ```env
  EXPO_APPLE_TEAM_ID=YOUR_TEAM_ID
  ```

* **Libmpv Integration (Android)**: The application uses a custom Expo config plugin (`plugins/withLibcppPickFirst.js`) to merge library symbols required by `libmpv.so` (the video player engine).
  Running a standard prebuild (`npx expo prebuild`) handles this configuration automatically.

* **Hermes and JS Proxies**: To prevent the Hermes engine from throwing `native state unsupported` exceptions, the custom player modules are wrapped in plain JavaScript objects rather than JS Proxy
  objects.

---

> [!NOTE]
> For copyright-related requests, please contact the maintainer using the contact information provided on [the website](https://seanime.app/docs/policies).

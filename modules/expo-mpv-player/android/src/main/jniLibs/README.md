# libmpv JNI Libraries

This directory must contain the prebuilt libmpv `.so` binaries for each ABI.

## Required Structure

```
jniLibs/
  arm64-v8a/
    libmpv.so
  armeabi-v7a/
    libmpv.so
  x86_64/
    libmpv.so
  x86/
    libmpv.so
```

## How to Obtain

The recommended source is the [mpv-android](https://github.com/mpv-android/mpv-android) project.

### Option A: Download from mpv-android releases

1. Go to https://github.com/mpv-android/mpv-android/releases
2. Download the universal debug APK
3. Extract the `.so` files from `lib/{abi}/` inside the APK (it's a zip)
4. Place them in the above structure
5. Keep `libc++_shared.so` in each ABI. libmpv needs this newer copy instead of React Native's

### Option B: Build from source

1. Clone https://github.com/mpv-android/mpv-android
2. Follow their buildscripts README to compile libmpv for Android
3. Copy the resulting `.so` files here

## Pinned Version

- **mpv-android version:** 2026-09-17 release (mpv 0b7ed670f, built with NDK r30)
- **Source:** https://github.com/mpv-android/mpv-android/releases/tag/2026-09-17
- **Date obtained:** 2026-10-31
- Keep this release's `libc++_shared.so`. `withLibcppPickFirst` packages it over React Native's copy.
- This release verifies TLS by default and has no CA store, so `MPVLayerRenderer` sets `tls-verify=no`. Without it every https source fails to open.

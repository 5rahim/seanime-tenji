# libmpv JNI Libraries

This directory must contain the prebuilt libmpv `.so` binaries for each ABI.

## Required Structure

```
jniLibs/
  arm64-v8a/
    libmpv.so
    libavcodec.so
    ...
  armeabi-v7a/
    libmpv.so
    libavcodec.so
    ...
  x86_64/
    libmpv.so
    ...
  x86/
    libmpv.so
    ...
```

## How to Obtain

The recommended source is the [mpv-android](https://github.com/mpv-android/mpv-android) project.

### Option A: Download from mpv-android releases

1. Go to https://github.com/mpv-android/mpv-android/releases
2. Download the universal debug APK
3. Extract the `.so` files from `lib/{abi}/` inside the APK (it's a zip)
4. Place them in the above structure
5. Remove `libc++_shared.so` from each ABI (React Native already provides it)
6. Apply the Android TV zero-copy `MediaCodec` (`AImageReader`) fixes:
   ```bash
   python3 modules/expo-mpv-player/android/src/main/jniLibs/patch-mpv-android-tv.py
   ```

### Option B: Build from source

1. Clone https://github.com/mpv-android/mpv-android
2. Apply the two source changes below to `mpv` and `ffmpeg` before compiling:
   - **`mpv` (`video/out/opengl/hwdec_aimagereader.c`)**:
     - Pass `maxImages = 2` (instead of `3`) to `AImageReader_newWithUsage` so constrained Android TV hardware decoders (such as Amlogic `4kosd` with a 14-buffer pool) do not run out of output buffers.
     - Call `gl->Finish()` at the start of `mapper_unmap()` before `eglDestroyImageKHR()` and `AImage_delete(p->image)` so Tile-Based Deferred Rendering (TBDR) GPUs (such as ARM Mali-G31) complete sampling the `GL_TEXTURE_EXTERNAL_OES` texture before the `AHardwareBuffer` is returned to `MediaCodec` without a fence.
   - **`ffmpeg` (`libavcodec/mediacodecdec.c`)**:
     - Pass `wait = true` in the initial `ff_mediacodec_dec_receive(avctx, s->ctx, frame, true)` call inside `mediacodec_receive_frame()` so steady-state decoding uses an 8 ms dequeue timeout instead of a `0 us` non-blocking poll that floods `AMediaCodec_queueInputBuffer` and starves hardware H.264 DPB reference buffers.
3. Follow their buildscripts README to compile libmpv for Android
4. Copy the resulting `.so` files here

## Pinned Version

- **mpv-android version:** 2026-03-22 release
- **Source:** https://github.com/mpv-android/mpv-android/releases/tag/2026-03-22
- **Date obtained:** 2025-07-03

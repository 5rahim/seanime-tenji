/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Inspired by and/or derived from Streamyfin (https://github.com/streamyfin/streamyfin)
 * and Findroid (https://github.com/findroid/findroid).
 * Copyright (c) the original authors and Seanime Tenji contributors.
 */

import ExpoModulesCore
import UIKit

private let orientationLockChangedNotification = Notification.Name("ExpoMpvPlayerOrientationLockChanged")
private let orientationLockMaskUserInfoKey = "mask"

public class ExpoMpvPlayerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoMpvPlayer")

        // Module-level functions (orientation lock)
        Function("lockLandscape") {
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: orientationLockChangedNotification,
                    object: nil,
                    userInfo: [orientationLockMaskUserInfoKey: "landscape"]
                )
            }
        }

        Function("unlockOrientation") {
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: orientationLockChangedNotification,
                    object: nil,
                    userInfo: [orientationLockMaskUserInfoKey: "portrait"]
                )
            }
        }

        Function("setWindowBrightness") { (brightness: Double) in }

        View(MpvSurfaceExpoView.self) {
            // gpu-next is Android-only (vo=avfoundation is required on iOS for PiP)
            Prop("gpuNext") { (_: MpvSurfaceExpoView, _: Bool) in }

            // All video load options via a single "source" prop
            Prop("source") { (view: MpvSurfaceExpoView, source: [String: Any]?) in
                guard let source = source,
                      let urlString = source["url"] as? String,
                      let videoURL = URL(string: urlString) else { return }

                // Parse external subtitles array
                var externalSubs: [(url: String, title: String?)] = []
                if let subsArray = source["externalSubtitles"] as? [[String: Any]] {
                    for sub in subsArray {
                        if let subUrl = sub["url"] as? String {
                            externalSubs.append((url: subUrl, title: sub["title"] as? String))
                        }
                    }
                }

                let config = VideoLoadConfig(
                    url: videoURL,
                    headers: source["headers"] as? [String: String],
                    externalSubtitles: externalSubs,
                    startPosition: source["startPosition"] as? Double,
                    autoplay: (source["autoplay"] as? Bool) ?? true
                )

                view.setSource(config)
            }

            Prop("nowPlayingMetadata") { (view: MpvSurfaceExpoView, metadata: [String: Any]?) in
                guard let metadata else {
                    view.setNowPlayingMetadata(nil)
                    return
                }

                view.setNowPlayingMetadata(NowPlayingMetadata(
                    title: metadata["title"] as? String,
                    artist: metadata["artist"] as? String,
                    albumTitle: metadata["albumTitle"] as? String,
                    artworkUri: metadata["artworkUri"] as? String
                ))
            }

            // Playback
            AsyncFunction("play") { (view: MpvSurfaceExpoView) in view.play() }

            AsyncFunction("pause") { (view: MpvSurfaceExpoView) in view.pause() }

            AsyncFunction("seekTo") { (view: MpvSurfaceExpoView, position: Double) in view.seekTo(position) }

            AsyncFunction("seekBy") { (view: MpvSurfaceExpoView, offset: Double) in view.seekBy(offset) }

            AsyncFunction("setSpeed") { (view: MpvSurfaceExpoView, speed: Double) in
                view.setSpeed(speed)
            }

            AsyncFunction("getSpeed") { (view: MpvSurfaceExpoView) -> Double in
                return view.getSpeed()
            }

            AsyncFunction("isPaused") { (view: MpvSurfaceExpoView) -> Bool in
                return view.isPaused()
            }

            AsyncFunction("getCurrentPosition") { (view: MpvSurfaceExpoView) -> Double in
                return view.getCurrentPosition()
            }

            AsyncFunction("getDuration") { (view: MpvSurfaceExpoView) -> Double in
                return view.getDuration()
            }

            // PiP
            AsyncFunction("startPictureInPicture") { (view: MpvSurfaceExpoView) in
                view.startPictureInPicture()
            }

            AsyncFunction("stopPictureInPicture") { (view: MpvSurfaceExpoView) in
                view.stopPictureInPicture()
            }

            AsyncFunction("isPictureInPictureSupported") { (view: MpvSurfaceExpoView) -> Bool in
                return view.isPictureInPictureSupported()
            }

            AsyncFunction("isPictureInPictureActive") { (view: MpvSurfaceExpoView) -> Bool in
                return view.isPictureInPictureActive()
            }

            // Subtitle controls
            AsyncFunction("getSubtitleTracks") { (view: MpvSurfaceExpoView) -> [[String: Any]] in
                return view.getSubtitleTracks()
            }

            AsyncFunction("getChapters") { (view: MpvSurfaceExpoView) -> [[String: Any]] in
                return view.getChapters()
            }

            AsyncFunction("setSubtitleTrack") { (view: MpvSurfaceExpoView, trackId: Int) in
                view.setSubtitleTrack(trackId)
            }

            AsyncFunction("disableSubtitles") { (view: MpvSurfaceExpoView) in
                view.disableSubtitles()
            }

            AsyncFunction("getCurrentSubtitleTrack") { (view: MpvSurfaceExpoView) -> Int in
                return view.getCurrentSubtitleTrack()
            }

            AsyncFunction("addSubtitleFile") { (view: MpvSurfaceExpoView, url: String, select: Bool) in
                view.addSubtitleFile(url, select: select)
            }

            AsyncFunction("setSubtitleDelay") { (view: MpvSurfaceExpoView, delay: Double) in
                view.setSubtitleDelay(delay)
            }

            AsyncFunction("setSubtitleFontSize") { (view: MpvSurfaceExpoView, size: Int) in
                view.setSubtitleFontSize(size)
            }

            AsyncFunction("setSubtitleVisibility") { (view: MpvSurfaceExpoView, visible: Bool) in
                view.setSubtitleVisibility(visible)
            }

            AsyncFunction("setSubtitlePosition") { (view: MpvSurfaceExpoView, position: Int) in
                view.setSubtitlePosition(position)
            }

            AsyncFunction("setSubtitleScale") { (view: MpvSurfaceExpoView, scale: Double) in
                view.setSubtitleScale(scale)
            }

            AsyncFunction("setSubtitleMarginY") { (view: MpvSurfaceExpoView, margin: Int) in
                view.setSubtitleMarginY(margin)
            }

            AsyncFunction("setSubtitleAlignX") { (view: MpvSurfaceExpoView, alignment: String) in
                view.setSubtitleAlignX(alignment)
            }

            AsyncFunction("setSubtitleAlignY") { (view: MpvSurfaceExpoView, alignment: String) in
                view.setSubtitleAlignY(alignment)
            }

            // Audio controls
            AsyncFunction("getAudioTracks") { (view: MpvSurfaceExpoView) -> [[String: Any]] in
                return view.getAudioTracks()
            }

            AsyncFunction("setAudioTrack") { (view: MpvSurfaceExpoView, trackId: Int) in
                view.setAudioTrack(trackId)
            }

            AsyncFunction("getCurrentAudioTrack") { (view: MpvSurfaceExpoView) -> Int in
                return view.getCurrentAudioTrack()
            }

            AsyncFunction("setAudioDelay") { (view: MpvSurfaceExpoView, delay: Double) in
                view.setAudioDelay(delay)
            }

            // Zoom
            AsyncFunction("setVideoZoom") { (view: MpvSurfaceExpoView, scale: Double) in
                view.setVideoZoom(scale)
            }

            AsyncFunction("setZoomedToFill") { (view: MpvSurfaceExpoView, zoomed: Bool) in
                view.setZoomedToFill(zoomed)
            }

            AsyncFunction("isZoomedToFill") { (view: MpvSurfaceExpoView) -> Bool in
                return view.isZoomedToFill()
            }

            // Technical info
            AsyncFunction("getTechnicalInfo") { (view: MpvSurfaceExpoView) -> [String: Any] in
                return view.getTechnicalInfo()
            }

            // Events
            Events("onLoad", "onPlaybackStateChange", "onProgress", "onError", "onTracksReady")
        }
    }
}

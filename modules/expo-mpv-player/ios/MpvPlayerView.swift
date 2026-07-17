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
import AVKit
import AVFoundation
import CoreMedia
import MPVKit
import UIKit

struct NowPlayingMetadata {
    let title: String?
    let artist: String?
    let albumTitle: String?
    let artworkUri: String?
}

/// Configuration passed from JSto load a video
struct VideoLoadConfig {
    let url: URL
    let headers: [String: String]?
    let externalSubtitles: [(url: String, title: String?)]
    let startPosition: Double?
    let autoplay: Bool
}

/// The native ExpoView that wraps an AVSampleBufferDisplayLayer and MPVLayerRenderer.
/// All async functions defined in the Expo module's View { } block are dispatched to this class.
final class MpvSurfaceExpoView: ExpoView, MPVLayerRendererDelegate, PiPControllerDelegate {

    // MARK: - Properties

    private let displayLayer = AVSampleBufferDisplayLayer()
    private var renderer: MPVLayerRenderer?
    private var pipController: PiPController?
    private var hasStartedRenderer = false
    private var isZoomedFill = false
    private let nowPlayingManager = MPVNowPlayingManager.shared
    private var lastNowPlayingSyncAt: CFAbsoluteTime = 0
    private var lastLayoutSize: CGSize = .zero

    // Pending config waiting for renderer to start
    private var pendingConfig: VideoLoadConfig?

    // Event emitters set by the Expo module
    let onLoad = EventDispatcher()
    let onProgress = EventDispatcher()
    let onPlaybackStateChange = EventDispatcher()
    let onError = EventDispatcher()
    let onTracksReady = EventDispatcher()

    // MARK: - Init

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)

        // Set up the display layer
        displayLayer.videoGravity = .resizeAspect
        displayLayer.preventsDisplaySleepDuringVideoPlayback = true

        layer.addSublayer(displayLayer)

        // Audio session
        configureAudioSession()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onPhoneLock),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        displayLayer.frame = bounds

        guard bounds.size != lastLayoutSize else { return }
        lastLayoutSize = bounds.size

        if pipController?.isPictureInPictureActive ?? false {
            applyPictureInPictureVideoGravity()
        } else {
            applyInlineVideoGravity()
        }
        renderer?.refreshVideoPresentation()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        clearNowPlayingInfo()
        renderer?.stop()
        renderer = nil
    }

    @objc private func onPhoneLock() {
        pause()
    }

    // MARK: - Audio Session

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
        } catch {
            print("[MpvPlayerView] Audio session error: \(error)")
        }
    }

    // MARK: - Source Prop

    func setSource(_ config: VideoLoadConfig) {
        if !hasStartedRenderer {
            startRenderer()
        }
        guard renderer != nil else {
            pendingConfig = config
            return
        }
        load(config)
    }

    private func startRenderer() {
        let newRenderer = MPVLayerRenderer(displayLayer: displayLayer)
        newRenderer.delegate = self
        do {
            try newRenderer.start()
        } catch {
            print("[MpvPlayerView] Failed to start renderer: \(error)")
            onError(["error": "\(error)"])
            return
        }
        renderer = newRenderer
        hasStartedRenderer = true

        // Set up PiP
        pipController = PiPController(sampleBufferDisplayLayer: displayLayer)
        pipController?.delegate = self

        // Play pending config if any
        if let config = pendingConfig {
            pendingConfig = nil
            load(config)
        }
    }

    private func load(_ config: VideoLoadConfig) {
        renderer?.load(
            url: config.url,
            headers: config.headers,
            externalSubtitles: config.externalSubtitles,
            startPosition: config.startPosition
        )

        if config.autoplay {
            play()
        }

        onLoad(["url": config.url.absoluteString])
    }

    private func applyInlineVideoGravity() {
        displayLayer.videoGravity = isZoomedFill ? .resizeAspectFill : .resizeAspect
    }

    private func applyPictureInPictureVideoGravity() {
        displayLayer.videoGravity = .resizeAspect
    }

    func setSpeed(_ speed: Double) { renderer?.setSpeed(speed) }
    func getSpeed() -> Double { return renderer?.getSpeed() ?? 1.0 }

    func isPaused() -> Bool { return renderer?.isPausedState ?? true }
    func getCurrentPosition() -> Double { return renderer?.cachedPosition ?? 0 }
    func getDuration() -> Double { return renderer?.cachedDuration ?? 0 }

    // MARK: - PiP Controls

    func startPictureInPicture() {
        renderer?.setPictureInPictureRenderingModeEnabled(true)
        applyPictureInPictureVideoGravity()

        if pipController?.startPictureInPicture() != true {
            renderer?.setPictureInPictureRenderingModeEnabled(false)
            applyInlineVideoGravity()
        }
    }

    func stopPictureInPicture() { pipController?.stopPictureInPicture() }
    func isPictureInPictureSupported() -> Bool { return pipController?.isPictureInPictureSupported ?? false }
    func isPictureInPictureActive() -> Bool { return pipController?.isPictureInPictureActive ?? false }

    // MARK: - Now Playing

    func setNowPlayingMetadata(_ metadata: NowPlayingMetadata?) {
        guard let metadata else {
            nowPlayingManager.clear()
            return
        }

        nowPlayingManager.setMetadata(
            title: metadata.title,
            artist: metadata.artist,
            albumTitle: metadata.albumTitle,
            artworkUrl: metadata.artworkUri
        )
        syncNowPlaying(force: true)
    }

    // MARK: - Subtitle Controls

    func getSubtitleTracks() -> [[String: Any]] { return renderer?.getSubtitleTracks() ?? [] }
    func getChapters() -> [[String: Any]] { return renderer?.getChapters() ?? [] }
    func setSubtitleTrack(_ trackId: Int) { renderer?.setSubtitleTrack(trackId) }
    func disableSubtitles() { renderer?.disableSubtitles() }
    func getCurrentSubtitleTrack() -> Int { return renderer?.getCurrentSubtitleTrack() ?? 0 }
    func addSubtitleFile(_ url: String, select: Bool) { renderer?.addSubtitleFile(url: url, select: select) }
    func setSubtitleDelay(_ delay: Double) { renderer?.setSubtitleDelay(delay) }
    func setSubtitleFontSize(_ size: Int) { renderer?.setSubtitleFontSize(size) }
    func setSubtitleVisibility(_ visible: Bool) { renderer?.setSubtitleVisibility(visible) }
    func setSubtitlePosition(_ position: Int) { renderer?.setSubtitlePosition(position) }
    func setSubtitleScale(_ scale: Double) { renderer?.setSubtitleScale(scale) }
    func setSubtitleMarginY(_ margin: Int) { renderer?.setSubtitleMarginY(margin) }
    func setSubtitleAlignX(_ alignment: String) { renderer?.setSubtitleAlignX(alignment) }
    func setSubtitleAlignY(_ alignment: String) { renderer?.setSubtitleAlignY(alignment) }

    // MARK: - Audio Controls

    func getAudioTracks() -> [[String: Any]] { return renderer?.getAudioTracks() ?? [] }
    func setAudioTrack(_ trackId: Int) { renderer?.setAudioTrack(trackId) }
    func getCurrentAudioTrack() -> Int { return renderer?.getCurrentAudioTrack() ?? 0 }
    func setAudioDelay(_ delay: Double) { renderer?.setAudioDelay(delay) }

    // MARK: - Zoom

    func setVideoZoom(_ scale: Double) {
        isZoomedFill = scale > 1.001
        if !(pipController?.isPictureInPictureActive ?? false) {
            applyInlineVideoGravity()
        }
        renderer?.setVideoZoom(scale)
    }

    func setZoomedToFill(_ zoomed: Bool) {
        isZoomedFill = zoomed
        if !(pipController?.isPictureInPictureActive ?? false) {
            applyInlineVideoGravity()
        }
    }

    func isZoomedToFill() -> Bool {
        return isZoomedFill
    }

    // MARK: - Technical Info

    func getTechnicalInfo() -> [String: Any] {
        return renderer?.getTechnicalInfo() ?? [:]
    }

    // MARK: - Now Playing Helpers

    private func setupRemoteCommands() {
        nowPlayingManager.setupRemoteCommands(
            playHandler: { [weak self] in self?.play() },
            pauseHandler: { [weak self] in self?.pause() },
            toggleHandler: { [weak self] in
                guard let self else { return }
                if self.renderer?.isPausedState ?? true {
                    self.play()
                } else {
                    self.pause()
                }
            },
            seekHandler: { [weak self] position in self?.seekTo(position) },
            skipForward: { [weak self] interval in self?.seekBy(interval) },
            skipBackward: { [weak self] interval in self?.seekBy(-interval) }
        )
    }

    private func currentPlaybackRate() -> Float {
        guard let renderer, !renderer.isPausedState else { return 0 }
        return Float(renderer.playbackSpeed)
    }

    private func syncNowPlaying(force: Bool = false) {
        let now = CFAbsoluteTimeGetCurrent()
        if !force && (now - lastNowPlayingSyncAt) < 1 {
            return
        }
        lastNowPlayingSyncAt = now
        nowPlayingManager.updatePlayback(
            position: renderer?.cachedPosition ?? 0,
            duration: renderer?.cachedDuration ?? 0,
            playbackRate: currentPlaybackRate()
        )
    }

    private func clearNowPlayingInfo() {
        nowPlayingManager.cleanupRemoteCommands()
        nowPlayingManager.clear()
        nowPlayingManager.deactivateAudioSession()
    }

    // MARK: - MPVLayerRendererDelegate

    func renderer(_ renderer: MPVLayerRenderer, didUpdatePosition position: Double, duration: Double, cacheSeconds: Double) {
        syncNowPlaying()
        onProgress([
            "position": position,
            "duration": duration,
            "cacheSeconds": cacheSeconds,
        ])

        // Update PiP timebase
        pipController?.setCurrentTimeFromSeconds(position, duration: duration)
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangePause isPaused: Bool) {
        syncNowPlaying(force: true)
        onPlaybackStateChange([
            "isPaused": isPaused,
            "isPlaying": !isPaused,
        ])

        // Update PiP rate
        pipController?.setPlaybackRate(isPaused ? 0 : Float(renderer.playbackSpeed))
        pipController?.updatePlaybackState()
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangeLoading isLoading: Bool) {
        onPlaybackStateChange(["isLoading": isLoading])
    }

    func renderer(_ renderer: MPVLayerRenderer, didBecomeReadyToSeek: Bool) {
        onPlaybackStateChange(["isReadyToSeek": true])
    }

    func renderer(_ renderer: MPVLayerRenderer, didBecomeTracksReady: Bool) {
        onTracksReady([:])
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangeEOF eofReached: Bool) {
        onPlaybackStateChange(["eofReached": eofReached])
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangeSpeed speed: Double) {
        onPlaybackStateChange(["speed": speed])
        if !renderer.isPausedState {
            pipController?.setPlaybackRate(Float(speed))
        }
        syncNowPlaying(force: true)
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangeSubtitleDelay delay: Double) {
        onPlaybackStateChange(["subtitleDelay": delay])
    }

    func renderer(_ renderer: MPVLayerRenderer, didChangeAudioDelay delay: Double) {
        onPlaybackStateChange(["audioDelay": delay])
    }

    // MARK: - PiPControllerDelegate

    func pipController(_ controller: PiPController, willStartPictureInPicture: Bool) {
        renderer?.setPictureInPictureRenderingModeEnabled(true)
        applyPictureInPictureVideoGravity()
        onPlaybackStateChange(["isPiPActive": true])
    }

    func pipController(_ controller: PiPController, didStartPictureInPicture: Bool) {
        guard !didStartPictureInPicture else { return }
        renderer?.setPictureInPictureRenderingModeEnabled(false)
        applyInlineVideoGravity()
        onPlaybackStateChange(["isPiPActive": false])
    }

    func pipController(_ controller: PiPController, willStopPictureInPicture: Bool) {}

    func pipController(_ controller: PiPController, didStopPictureInPicture: Bool) {
        renderer?.setPictureInPictureRenderingModeEnabled(false)
        applyInlineVideoGravity()
        onPlaybackStateChange(["isPiPActive": false])
    }

    func pipController(_ controller: PiPController, didTransitionToRenderSize renderSize: CMVideoDimensions) {
        applyPictureInPictureVideoGravity()
        renderer?.refreshVideoPresentation()
    }

    func pipController(_ controller: PiPController, restoreUserInterfaceForPictureInPictureStop completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }

    func pipControllerPlay(_ controller: PiPController) {
        play()
    }

    func pipControllerPause(_ controller: PiPController) {
        pause()
    }

    func pipController(_ controller: PiPController, skipByInterval interval: CMTime) {
        let seconds = CMTimeGetSeconds(interval)
        seekBy(seconds)
    }

    func pipControllerIsPlaying(_ controller: PiPController) -> Bool {
        return !(renderer?.isPausedState ?? true)
    }

    func pipControllerDuration(_ controller: PiPController) -> Double {
        return renderer?.cachedDuration ?? 0
    }

    func pipControllerCurrentPosition(_ controller: PiPController) -> Double {
        return renderer?.cachedPosition ?? 0
    }

    // MARK: - Playback Controls

    func play() {
        nowPlayingManager.activateAudioSession()
        setupRemoteCommands()
        renderer?.play()
        syncNowPlaying(force: true)
    }

    func pause() {
        renderer?.pause()
        syncNowPlaying(force: true)
    }

    func seekTo(_ position: Double) {
        renderer?.seek(to: position)
        syncNowPlaying(force: true)
    }

    func seekBy(_ offset: Double) {
        renderer?.seek(by: offset)
        syncNowPlaying(force: true)
    }
}

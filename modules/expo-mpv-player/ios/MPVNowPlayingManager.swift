/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Inspired by and/or derived from Streamyfin (https://github.com/streamyfin/streamyfin)
 * and Findroid (https://github.com/findroid/findroid).
 * Copyright (c) the original authors and Seanime Tenji contributors.
 */

import AVFoundation
import MediaPlayer
import UIKit

final class MPVNowPlayingManager {
    static let shared = MPVNowPlayingManager()

    private var title: String?
    private var artist: String?
    private var albumTitle: String?
    private var artworkSource: String?
    private var cachedArtwork: MPMediaItemArtwork?
    private var duration: TimeInterval = 0
    private var position: TimeInterval = 0
    private var playbackRate: Float = 0
    private var isCommandsSetup = false
    private var artworkTask: URLSessionDataTask?
    private let audioQueue = DispatchQueue(label: "mpv.player.audio-session", qos: .userInitiated)

    private init() {}

    func activateAudioSession(completion: @escaping (Result<Void, Error>) -> Void) {
        audioQueue.async {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .moviePlayback)
                try session.setActive(true)
                DispatchQueue.main.async { completion(.success(())) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    func deactivateAudioSession() {
        audioQueue.async {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("[NowPlaying] Audio session deactivation failed: \(error)")
            }
        }
    }

    func setupRemoteCommands(
        playHandler: @escaping () -> Void,
        pauseHandler: @escaping () -> Void,
        toggleHandler: @escaping () -> Void,
        seekHandler: @escaping (TimeInterval) -> Void,
        skipForward: @escaping (TimeInterval) -> Void,
        skipBackward: @escaping (TimeInterval) -> Void
    ) {
        guard !isCommandsSetup else { return }
        isCommandsSetup = true

        DispatchQueue.main.async {
            UIApplication.shared.beginReceivingRemoteControlEvents()
        }

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { _ in
            playHandler()
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { _ in
            pauseHandler()
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { _ in
            toggleHandler()
            return .success
        }

        commandCenter.skipForwardCommand.isEnabled = true
        commandCenter.skipForwardCommand.preferredIntervals = [15]
        commandCenter.skipForwardCommand.addTarget { event in
            if let skipEvent = event as? MPSkipIntervalCommandEvent {
                skipForward(skipEvent.interval)
            }
            return .success
        }

        commandCenter.skipBackwardCommand.isEnabled = true
        commandCenter.skipBackwardCommand.preferredIntervals = [15]
        commandCenter.skipBackwardCommand.addTarget { event in
            if let skipEvent = event as? MPSkipIntervalCommandEvent {
                skipBackward(skipEvent.interval)
            }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.addTarget { event in
            if let positionEvent = event as? MPChangePlaybackPositionCommandEvent {
                seekHandler(positionEvent.positionTime)
            }
            return .success
        }
    }

    func cleanupRemoteCommands() {
        guard isCommandsSetup else { return }
        isCommandsSetup = false

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.removeTarget(nil)
        commandCenter.pauseCommand.removeTarget(nil)
        commandCenter.togglePlayPauseCommand.removeTarget(nil)
        commandCenter.skipForwardCommand.removeTarget(nil)
        commandCenter.skipBackwardCommand.removeTarget(nil)
        commandCenter.changePlaybackPositionCommand.removeTarget(nil)

        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents()
        }
    }

    func setMetadata(title: String?, artist: String?, albumTitle: String?, artworkUrl: String?) {
        self.title = title
        self.artist = artist
        self.albumTitle = albumTitle

        guard artworkSource != artworkUrl else {
            refresh()
            return
        }

        artworkTask?.cancel()
        artworkTask = nil
        artworkSource = artworkUrl
        cachedArtwork = nil

        guard let artworkUrl, !artworkUrl.isEmpty else {
            refresh()
            return
        }

        if let fileUrl = URL(string: artworkUrl), fileUrl.isFileURL {
            if let image = UIImage(contentsOfFile: fileUrl.path) {
                setArtwork(image)
            } else {
                refresh()
            }
            return
        }

        guard let url = URL(string: artworkUrl) else {
            refresh()
            return
        }

        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self else { return }
            if let data, let image = UIImage(data: data) {
                self.setArtwork(image)
            } else {
                self.refresh()
            }
        }
        artworkTask?.resume()
    }

    func updatePlayback(position: TimeInterval, duration: TimeInterval, playbackRate: Float) {
        self.position = position
        self.duration = duration
        self.playbackRate = playbackRate
        refresh()
    }

    func clear() {
        artworkTask?.cancel()
        artworkTask = nil
        title = nil
        artist = nil
        albumTitle = nil
        artworkSource = nil
        cachedArtwork = nil
        duration = 0
        position = 0
        playbackRate = 0
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        }
    }

    private func setArtwork(_ image: UIImage) {
        cachedArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        refresh()
    }

    private func refresh() {
        guard duration > 0 else { return }

        let title = self.title
        let artist = self.artist
        let albumTitle = self.albumTitle
        let cachedArtwork = self.cachedArtwork
        let duration = self.duration
        let position = self.position
        let playbackRate = self.playbackRate

        DispatchQueue.main.async {
            var info: [String: Any] = [
                MPMediaItemPropertyPlaybackDuration: duration,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                MPNowPlayingInfoPropertyPlaybackRate: playbackRate,
            ]

            if let title { info[MPMediaItemPropertyTitle] = title }
            if let artist { info[MPMediaItemPropertyArtist] = artist }
            if let albumTitle { info[MPMediaItemPropertyAlbumTitle] = albumTitle }
            if let cachedArtwork { info[MPMediaItemPropertyArtwork] = cachedArtwork }

            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }
}
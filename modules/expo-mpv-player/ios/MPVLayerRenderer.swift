/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Inspired by and/or derived from Streamyfin (https://github.com/streamyfin/streamyfin)
 * and Findroid (https://github.com/findroid/findroid).
 * Copyright (c) the original authors and Seanime Tenji contributors.
 */

import UIKit
import MPVKit
import CoreMedia
import CoreVideo
import AVFoundation

protocol MPVLayerRendererDelegate: AnyObject {
    func renderer(_ renderer: MPVLayerRenderer, didUpdatePosition position: Double, duration: Double, cacheSeconds: Double)
    func renderer(_ renderer: MPVLayerRenderer, didChangePause isPaused: Bool)
    func renderer(_ renderer: MPVLayerRenderer, didChangeLoading isLoading: Bool)
    func renderer(_ renderer: MPVLayerRenderer, didBecomeReadyToSeek: Bool)
    func renderer(_ renderer: MPVLayerRenderer, didBecomeTracksReady: Bool)
    func renderer(_ renderer: MPVLayerRenderer, didChangeEOF eofReached: Bool)
    func renderer(_ renderer: MPVLayerRenderer, didChangeSpeed speed: Double)
    func renderer(_ renderer: MPVLayerRenderer, didChangeSubtitleDelay delay: Double)
    func renderer(_ renderer: MPVLayerRenderer, didChangeAudioDelay delay: Double)
}

/// Core mpv wrapper using vo_avfoundation for video output.
/// Renders video directly to AVSampleBufferDisplayLayer for PiP support.
final class MPVLayerRenderer {
    enum RendererError: Error {
        case mpvCreationFailed
        case mpvInitialization(Int32)
    }

    private let displayLayer: AVSampleBufferDisplayLayer
    private let queue = DispatchQueue(label: "mpv.avfoundation", qos: .userInitiated)
    private let stateQueue = DispatchQueue(label: "mpv.avfoundation.state", attributes: .concurrent)

    private var mpv: OpaquePointer?
    private var isRunning = false
    private var isStopping = false

    // KVO observation for display layer status
    private var statusObservation: NSKeyValueObservation?

    weak var delegate: MPVLayerRendererDelegate?

    // external subtitles to add after file loads
    private var pendingExternalSubtitles: [(url: String, title: String?)] = []

    // Thread-safe state
    private var _cachedDuration: Double = 0
    private var _cachedPosition: Double = 0
    private var _cachedCacheSeconds: Double = 0
    private var _isPaused: Bool = true
    private var _playbackSpeed: Double = 1.0
    private var _isLoading: Bool = false
    private var _isReadyToSeek: Bool = false
    private var _isSeeking: Bool = false
    private var requestedVideoZoomScale: Double = 1.0
    private var isPictureInPictureRenderingModeEnabled = false

    // Progress update throttling
    private var lastProgressUpdateTime: CFAbsoluteTime = 0
    private let progressUpdateInterval: CFAbsoluteTime = 0.25

    // MARK: - Thread-safe accessors

    var cachedDuration: Double {
        get { stateQueue.sync { _cachedDuration } }
        set { stateQueue.async(flags: .barrier) { self._cachedDuration = newValue } }
    }
    var cachedPosition: Double {
        get { stateQueue.sync { _cachedPosition } }
        set { stateQueue.async(flags: .barrier) { self._cachedPosition = newValue } }
    }
    var cachedCacheSeconds: Double {
        get { stateQueue.sync { _cachedCacheSeconds } }
        set { stateQueue.async(flags: .barrier) { self._cachedCacheSeconds = newValue } }
    }
    var isPausedState: Bool {
        get { stateQueue.sync { _isPaused } }
        set { stateQueue.async(flags: .barrier) { self._isPaused = newValue } }
    }
    var playbackSpeed: Double {
        get { stateQueue.sync { _playbackSpeed } }
        set { stateQueue.async(flags: .barrier) { self._playbackSpeed = newValue } }
    }
    var isLoading: Bool {
        get { stateQueue.sync { _isLoading } }
        set { stateQueue.async(flags: .barrier) { self._isLoading = newValue } }
    }
    var isReadyToSeek: Bool {
        get { stateQueue.sync { _isReadyToSeek } }
        set { stateQueue.async(flags: .barrier) { self._isReadyToSeek = newValue } }
    }
    var isSeeking: Bool {
        get { stateQueue.sync { _isSeeking } }
        set { stateQueue.async(flags: .barrier) { self._isSeeking = newValue } }
    }

    // MARK: - Init

    init(displayLayer: AVSampleBufferDisplayLayer) {
        self.displayLayer = displayLayer
        observeDisplayLayerStatus()
    }

    deinit {
        stop()
    }

    // MARK: - Display Layer Recovery

    private func observeDisplayLayerStatus() {
        statusObservation = displayLayer.observe(\.status, options: [.new]) { [weak self] layer, _ in
            guard let self else { return }
            if layer.status == .failed {
                print("[MPV] Display layer failed - auto-resetting decoder")
                self.queue.async { self.performDecoderReset() }
            }
        }
    }

    private func performDecoderReset() {
        guard let handle = mpv else { return }
        commandSync(handle, ["set", "hwdec", "no"])
        commandSync(handle, ["set", "hwdec", "auto"])
    }

    // MARK: - Lifecycle

    func start() throws {
        guard !isRunning else { return }
        guard let handle = mpv_create() else {
            throw RendererError.mpvCreationFailed
        }
        mpv = handle

        #if DEBUG
        checkError(mpv_request_log_messages(handle, "warn"))
        #else
        checkError(mpv_request_log_messages(handle, "no"))
        #endif

        // Pass AVSampleBufferDisplayLayer to mpv via --wid
        let layerPtrInt = Int(bitPattern: Unmanaged.passUnretained(displayLayer).toOpaque())
        var displayLayerPtr = Int64(layerPtrInt)
        checkError(mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &displayLayerPtr))

        // Use AVFoundation video output for PiP support
        checkError(mpv_set_option_string(handle, "vo", "avfoundation"))

        // Composite subtitles into the AVFoundation video frames from startup so
        // PiP and rotation changes use the same subtitle path.
        checkError(mpv_set_option_string(handle, "avfoundation-composite-osd", "yes"))

        // Hardware decoding
        #if targetEnvironment(simulator)
        checkError(mpv_set_option_string(handle, "hwdec", "no"))
        #else
        checkError(mpv_set_option_string(handle, "hwdec", "videotoolbox"))
        #endif
        checkError(mpv_set_option_string(handle, "hwdec-codecs", "all"))
        checkError(mpv_set_option_string(handle, "hwdec-software-fallback", "yes"))

        // Subtitle settings
        checkError(mpv_set_option_string(handle, "video-zoom", "0"))
        checkError(mpv_set_option_string(handle, "subs-match-os-language", "yes"))
        checkError(mpv_set_option_string(handle, "subs-fallback", "yes"))

        // Initialize
        let initStatus = mpv_initialize(handle)
        guard initStatus >= 0 else {
            throw RendererError.mpvInitialization(initStatus)
        }

        observeProperties()

        // Setup wakeup callback
        mpv_set_wakeup_callback(handle, { ctx in
            guard let ctx = ctx else { return }
            let instance = Unmanaged<MPVLayerRenderer>.fromOpaque(ctx).takeUnretainedValue()
            instance.processEvents()
        }, Unmanaged.passUnretained(self).toOpaque())

        isRunning = true
    }

    func stop() {
        if isStopping { return }
        if !isRunning, mpv == nil { return }
        isRunning = false
        isStopping = true

        statusObservation?.invalidate()
        statusObservation = nil

        let handle = mpv
        mpv = nil

        if let handle {
            queue.async {
                mpv_set_wakeup_callback(handle, nil, nil)
                mpv_terminate_destroy(handle)
            }
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if #available(iOS 18.0, *) {
                self.displayLayer.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil)
            } else {
                self.displayLayer.flushAndRemoveImage()
            }
        }

        isStopping = false
    }

    // MARK: - Loading

    func load(
        url: URL,
        headers: [String: String]? = nil,
        externalSubtitles: [(url: String, title: String?)]? = nil,
        startPosition: Double? = nil
    ) {
        pendingExternalSubtitles = externalSubtitles ?? []

        queue.async { [weak self] in
            guard let self else { return }
            self.isLoading = true
            self.isReadyToSeek = false
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.delegate?.renderer(self, didChangeLoading: true)
            }

            guard let handle = self.mpv else { return }

            // Stop previous playback
            self.command(handle, ["stop"])

            // Set HTTP headers
            self.updateHTTPHeaders(headers)

            // Set start position
            if let startPos = startPosition, startPos > 0 {
                self.setProperty(name: "start", value: String(format: "%.2f", startPos))
            } else {
                self.setProperty(name: "start", value: "0")
            }

            self.applyVideoPresentation()

            // Disable subtitles initially if we have external subs
            if !self.pendingExternalSubtitles.isEmpty {
                self.setProperty(name: "sid", value: "no")
            }

            let target = url.isFileURL ? url.path : url.absoluteString
            self.command(handle, ["loadfile", target, "replace"])
        }
    }

    // MARK: - Property Helpers

    private func setProperty(name: String, value: String) {
        guard let handle = mpv else { return }
        let status = mpv_set_property_string(handle, name, value)
        if status < 0 {
            print("[MPV] Failed to set property \(name)=\(value) (\(status))")
        }
    }

    private func clearProperty(name: String) {
        guard let handle = mpv else { return }
        let status = mpv_set_property(handle, name, MPV_FORMAT_NONE, nil)
        if status < 0 {
            print("[MPV] Failed to clear property \(name) (\(status))")
        }
    }

    private func videoZoomPropertyValue(for scale: Double) -> String {
        String(format: "%.6f", log2(max(1.0, scale)))
    }

    private func applyVideoZoom() {
        let effectiveScale = isPictureInPictureRenderingModeEnabled ? 1.0 : requestedVideoZoomScale
        setProperty(name: "video-zoom", value: videoZoomPropertyValue(for: effectiveScale))
    }

    private func applyVideoPresentation() {
        applyVideoZoom()
    }

    func refreshVideoPresentation() {
        queue.async { [weak self] in
            self?.applyVideoPresentation()
        }
    }

    private func updateHTTPHeaders(_ headers: [String: String]?) {
        guard let headers, !headers.isEmpty else {
            clearProperty(name: "http-header-fields")
            return
        }
        let headerString = headers
            .map { key, value in "\(key): \(value)" }
            .joined(separator: "\r\n")
        setProperty(name: "http-header-fields", value: headerString)
    }

    private func observeProperties() {
        guard let handle = mpv else { return }
        let properties: [(String, mpv_format)] = [
            ("duration", MPV_FORMAT_DOUBLE),
            ("time-pos", MPV_FORMAT_DOUBLE),
            ("pause", MPV_FORMAT_FLAG),
            ("track-list/count", MPV_FORMAT_INT64),
            ("sid", MPV_FORMAT_STRING),
            ("aid", MPV_FORMAT_STRING),
            ("paused-for-cache", MPV_FORMAT_FLAG),
            ("demuxer-cache-duration", MPV_FORMAT_DOUBLE),
            ("eof-reached", MPV_FORMAT_FLAG),
            ("speed", MPV_FORMAT_DOUBLE),
            ("sub-delay", MPV_FORMAT_DOUBLE),
            ("audio-delay", MPV_FORMAT_DOUBLE),
        ]
        for (name, format) in properties {
            mpv_observe_property(handle, 0, name, format)
        }
    }

    private func command(_ handle: OpaquePointer, _ args: [String]) {
        guard !args.isEmpty else { return }
        _ = withCStringArray(args) { pointer in
            mpv_command_async(handle, 0, pointer)
        }
    }

    @discardableResult
    private func commandSync(_ handle: OpaquePointer, _ args: [String]) -> Int32 {
        guard !args.isEmpty else { return -1 }
        return withCStringArray(args) { pointer in
            mpv_command(handle, pointer)
        }
    }

    private func checkError(_ status: CInt) {
        if status < 0 {
            print("[MPV] API error: \(String(cString: mpv_error_string(status)))")
        }
    }

    // MARK: - Event Handling

    private func processEvents() {
        queue.async { [weak self] in
            guard let self else { return }

            while self.mpv != nil && !self.isStopping {
                guard let handle = self.mpv,
                      let eventPointer = mpv_wait_event(handle, 0) else { return }
                let event = eventPointer.pointee
                if event.event_id == MPV_EVENT_NONE { break }
                self.handleEvent(event)
                if event.event_id == MPV_EVENT_SHUTDOWN { break }
            }
        }
    }

    private func handleEvent(_ event: mpv_event) {
        switch event.event_id {
        case MPV_EVENT_FILE_LOADED:
            applyVideoPresentation()
            // Add external subtitles now that file is loaded
            if !pendingExternalSubtitles.isEmpty, let handle = mpv {
                for (index, sub) in pendingExternalSubtitles.enumerated() {
                    print("[MPV] Adding external subtitle [\(index)]: \(sub.url.prefix(60))")
                    if let title = sub.title, !title.isEmpty {
                        commandSync(handle, ["sub-add", sub.url, "auto", title])
                    } else {
                        commandSync(handle, ["sub-add", sub.url, "auto"])
                    }
                }
                pendingExternalSubtitles = []
            }

            if !isReadyToSeek {
                isReadyToSeek = true
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didBecomeReadyToSeek: true)
                }
            }

            if isLoading {
                isLoading = false
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeLoading: false)
                }
            }

        case MPV_EVENT_SEEK:
            isSeeking = true
            if !isLoading {
                isLoading = true
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeLoading: true)
                }
            }

        case MPV_EVENT_PLAYBACK_RESTART:
            applyVideoPresentation()
            isSeeking = false
            if isLoading {
                isLoading = false
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeLoading: false)
                }
            }

        case MPV_EVENT_PROPERTY_CHANGE:
            if let property = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee.name {
                let name = String(cString: property)
                refreshProperty(named: name)
            }

        case MPV_EVENT_LOG_MESSAGE:
            if let logMsg = event.data?.assumingMemoryBound(to: mpv_event_log_message.self) {
                let text = String(cString: logMsg.pointee.text)
                let lower = text.lowercased()
                if lower.contains("error") {
                    print("[MPV] ERROR: \(text)")
                }
            }

        case MPV_EVENT_SHUTDOWN:
            print("[MPV] Shutdown")

        default:
            break
        }
    }

    private func refreshProperty(named name: String) {
        guard let handle = mpv else { return }

        switch name {
        case "duration":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                cachedDuration = value
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didUpdatePosition: self.cachedPosition, duration: self.cachedDuration, cacheSeconds: self.cachedCacheSeconds)
                }
            }

        case "time-pos":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                cachedPosition = value
                let now = CFAbsoluteTimeGetCurrent()
                let shouldUpdate = isSeeking || (now - lastProgressUpdateTime >= progressUpdateInterval)
                if shouldUpdate {
                    lastProgressUpdateTime = now
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.delegate?.renderer(self, didUpdatePosition: self.cachedPosition, duration: self.cachedDuration, cacheSeconds: self.cachedCacheSeconds)
                    }
                }
            }

        case "demuxer-cache-duration":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                cachedCacheSeconds = value
            }

        case "pause":
            var flag: Int32 = 0
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_FLAG, value: &flag) >= 0 {
                let newPaused = flag != 0
                if newPaused != isPausedState {
                    isPausedState = newPaused
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.delegate?.renderer(self, didChangePause: self.isPausedState)
                    }
                }
            }

        case "paused-for-cache":
            var flag: Int32 = 0
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_FLAG, value: &flag) >= 0 {
                let buffering = flag != 0
                if buffering != isLoading {
                    isLoading = buffering
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.delegate?.renderer(self, didChangeLoading: buffering)
                    }
                }
            }

        case "track-list/count":
            var trackCount: Int64 = 0
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_INT64, value: &trackCount) >= 0 && trackCount > 0 {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didBecomeTracksReady: true)
                }
            }

        case "sid", "aid":
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.delegate?.renderer(self, didBecomeTracksReady: true)
            }

        case "eof-reached":
            var flag: Int32 = 0
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_FLAG, value: &flag) >= 0 {
                let eof = flag != 0
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeEOF: eof)
                }
            }

        case "speed":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                playbackSpeed = value
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeSpeed: value)
                }
            }

        case "sub-delay":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeSubtitleDelay: value)
                }
            }

        case "audio-delay":
            var value = Double(0)
            if getProperty(handle: handle, name: name, format: MPV_FORMAT_DOUBLE, value: &value) >= 0 {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.delegate?.renderer(self, didChangeAudioDelay: value)
                }
            }

        default:
            break
        }
    }

    // MARK: - Property Reading

    private func getStringProperty(handle: OpaquePointer, name: String) -> String? {
        var result: String?
        if let cString = mpv_get_property_string(handle, name) {
            result = String(cString: cString)
            mpv_free(cString)
        }
        return result
    }

    @discardableResult
    private func getProperty<T>(handle: OpaquePointer, name: String, format: mpv_format, value: inout T) -> Int32 {
        return withUnsafeMutablePointer(to: &value) { mutablePointer in
            return mpv_get_property(handle, name, format, mutablePointer)
        }
    }

    @inline(__always)
    private func withCStringArray<R>(_ args: [String], body: (UnsafeMutablePointer<UnsafePointer<CChar>?>?) -> R) -> R {
        var cStrings = [UnsafeMutablePointer<CChar>?]()
        cStrings.reserveCapacity(args.count + 1)
        for s in args { cStrings.append(strdup(s)) }
        cStrings.append(nil)
        defer { for ptr in cStrings where ptr != nil { free(ptr) } }
        return cStrings.withUnsafeMutableBufferPointer { buffer in
            return buffer.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buffer.count) { rebound in
                return body(UnsafeMutablePointer(mutating: rebound))
            }
        }
    }

    // MARK: - Playback Controls

    func play() {
        setProperty(name: "pause", value: "no")
    }

    func pause() {
        setProperty(name: "pause", value: "yes")
    }

    func seek(to seconds: Double) {
        guard let handle = mpv else { return }
        let clamped = max(0, seconds)
        cachedPosition = clamped
        commandSync(handle, ["seek", String(clamped), "absolute"])
    }

    func seek(by seconds: Double) {
        guard let handle = mpv else { return }
        let newPosition = max(0, cachedPosition + seconds)
        cachedPosition = newPosition
        commandSync(handle, ["seek", String(seconds), "relative"])
    }

    func setSpeed(_ speed: Double) {
        playbackSpeed = speed
        setProperty(name: "speed", value: String(speed))
    }

    func getSpeed() -> Double {
        guard let handle = mpv else { return 1.0 }
        var speed: Double = 1.0
        getProperty(handle: handle, name: "speed", format: MPV_FORMAT_DOUBLE, value: &speed)
        return speed
    }

    // MARK: - Subtitle Controls

    func getSubtitleTracks() -> [[String: Any]] {
        guard let handle = mpv else { return [] }
        var tracks: [[String: Any]] = []
        var trackCount: Int64 = 0
        getProperty(handle: handle, name: "track-list/count", format: MPV_FORMAT_INT64, value: &trackCount)

        for i in 0..<trackCount {
            guard let trackType = getStringProperty(handle: handle, name: "track-list/\(i)/type"),
                  trackType == "sub" else { continue }

            var trackId: Int64 = 0
            getProperty(handle: handle, name: "track-list/\(i)/id", format: MPV_FORMAT_INT64, value: &trackId)
            var track: [String: Any] = ["id": Int(trackId)]

            if let title = getStringProperty(handle: handle, name: "track-list/\(i)/title") {
                track["title"] = title
            }
            if let lang = getStringProperty(handle: handle, name: "track-list/\(i)/lang") {
                track["lang"] = lang
            }
            if let codec = getStringProperty(handle: handle, name: "track-list/\(i)/codec"), !codec.isEmpty {
                track["codec"] = codec
            }
            var selected: Int32 = 0
            getProperty(handle: handle, name: "track-list/\(i)/selected", format: MPV_FORMAT_FLAG, value: &selected)
            track["selected"] = selected != 0

            tracks.append(track)
        }
        return tracks
    }

    func getChapters() -> [[String: Any]] {
        guard let handle = mpv else { return [] }
        var chapters: [[String: Any]] = []
        var chapterCount: Int64 = 0
        getProperty(handle: handle, name: "chapter-list/count", format: MPV_FORMAT_INT64, value: &chapterCount)

        for i in 0..<chapterCount {
            var chapter: [String: Any] = ["id": Int(i)]
            if let title = getStringProperty(handle: handle, name: "chapter-list/\(i)/title") {
                chapter["title"] = title
            }
            var time: Double = 0.0
            getProperty(handle: handle, name: "chapter-list/\(i)/time", format: MPV_FORMAT_DOUBLE, value: &time)
            chapter["time"] = time

            chapters.append(chapter)
        }
        return chapters
    }

    func setSubtitleTrack(_ trackId: Int) {
        if trackId < 0 {
            setProperty(name: "sid", value: "no")
        } else {
            setProperty(name: "sid", value: String(trackId))
        }
    }

    func disableSubtitles() {
        setProperty(name: "sid", value: "no")
    }

    func getCurrentSubtitleTrack() -> Int {
        guard let handle = mpv else { return 0 }
        var sid: Int64 = 0
        getProperty(handle: handle, name: "sid", format: MPV_FORMAT_INT64, value: &sid)
        return Int(sid)
    }

    func addSubtitleFile(url: String, select: Bool = true) {
        guard let handle = mpv else { return }
        let flag = select ? "select" : "cached"
        commandSync(handle, ["sub-add", url, flag])
    }

    func setSubtitleDelay(_ delay: Double) {
        setProperty(name: "sub-delay", value: String(delay))
    }

    func setSubtitleFontSize(_ size: Int) {
        setProperty(name: "sub-font-size", value: String(size))
    }

    func setSubtitleVisibility(_ visible: Bool) {
        setProperty(name: "sub-visibility", value: visible ? "yes" : "no")
    }

    func setSubtitlePosition(_ position: Int) {
        setProperty(name: "sub-pos", value: String(position))
    }

    func setSubtitleScale(_ scale: Double) {
        setProperty(name: "sub-scale", value: String(max(0.1, scale)))
    }

    func setSubtitleMarginY(_ margin: Int) {
        setProperty(name: "sub-margin-y", value: String(margin))
    }

    func setSubtitleAlignX(_ alignment: String) {
        setProperty(name: "sub-align-x", value: alignment)
    }

    func setSubtitleAlignY(_ alignment: String) {
        setProperty(name: "sub-align-y", value: alignment)
    }

    func setVideoZoom(_ scale: Double) {
        requestedVideoZoomScale = max(1.0, scale)
        applyVideoZoom()
    }

    func setPictureInPictureRenderingModeEnabled(_ enabled: Bool) {
        guard isPictureInPictureRenderingModeEnabled != enabled else { return }
        isPictureInPictureRenderingModeEnabled = enabled
        applyVideoPresentation()
    }

    // MARK: - Audio Controls

    func getAudioTracks() -> [[String: Any]] {
        guard let handle = mpv else { return [] }
        var tracks: [[String: Any]] = []
        var trackCount: Int64 = 0
        getProperty(handle: handle, name: "track-list/count", format: MPV_FORMAT_INT64, value: &trackCount)

        for i in 0..<trackCount {
            guard let trackType = getStringProperty(handle: handle, name: "track-list/\(i)/type"),
                  trackType == "audio" else { continue }

            var trackId: Int64 = 0
            getProperty(handle: handle, name: "track-list/\(i)/id", format: MPV_FORMAT_INT64, value: &trackId)
            var track: [String: Any] = ["id": Int(trackId)]

            if let title = getStringProperty(handle: handle, name: "track-list/\(i)/title") {
                track["title"] = title
            }
            if let lang = getStringProperty(handle: handle, name: "track-list/\(i)/lang") {
                track["lang"] = lang
            }
            if let codec = getStringProperty(handle: handle, name: "track-list/\(i)/codec") {
                track["codec"] = codec
            }
            var channels: Int64 = 0
            getProperty(handle: handle, name: "track-list/\(i)/audio-channels", format: MPV_FORMAT_INT64, value: &channels)
            if channels > 0 { track["channels"] = Int(channels) }

            var selected: Int32 = 0
            getProperty(handle: handle, name: "track-list/\(i)/selected", format: MPV_FORMAT_FLAG, value: &selected)
            track["selected"] = selected != 0

            tracks.append(track)
        }
        return tracks
    }

    func setAudioTrack(_ trackId: Int) {
        setProperty(name: "aid", value: String(trackId))
    }

    func getCurrentAudioTrack() -> Int {
        guard let handle = mpv else { return 0 }
        var aid: Int64 = 0
        getProperty(handle: handle, name: "aid", format: MPV_FORMAT_INT64, value: &aid)
        return Int(aid)
    }

    func setAudioDelay(_ delay: Double) {
        setProperty(name: "audio-delay", value: String(delay))
    }

    // MARK: - Technical Info

    func getTechnicalInfo() -> [String: Any] {
        guard let handle = mpv else { return [:] }
        var info: [String: Any] = [:]

        var videoWidth: Int64 = 0
        var videoHeight: Int64 = 0
        if getProperty(handle: handle, name: "video-params/w", format: MPV_FORMAT_INT64, value: &videoWidth) >= 0 {
            info["videoWidth"] = Int(videoWidth)
        }
        if getProperty(handle: handle, name: "video-params/h", format: MPV_FORMAT_INT64, value: &videoHeight) >= 0 {
            info["videoHeight"] = Int(videoHeight)
        }
        if let videoCodec = getStringProperty(handle: handle, name: "video-format") {
            info["videoCodec"] = videoCodec
        }
        if let audioCodec = getStringProperty(handle: handle, name: "audio-codec-name") {
            info["audioCodec"] = audioCodec
        }
        var fps: Double = 0
        if getProperty(handle: handle, name: "container-fps", format: MPV_FORMAT_DOUBLE, value: &fps) >= 0 && fps > 0 {
            info["fps"] = fps
        }
        var cacheSeconds: Double = 0
        if getProperty(handle: handle, name: "demuxer-cache-duration", format: MPV_FORMAT_DOUBLE, value: &cacheSeconds) >= 0 {
            info["cacheSeconds"] = cacheSeconds
        }
        var droppedFrames: Int64 = 0
        if getProperty(handle: handle, name: "frame-drop-count", format: MPV_FORMAT_INT64, value: &droppedFrames) >= 0 {
            info["droppedFrames"] = Int(droppedFrames)
        }

        return info
    }

    /// No-op for vo_avfoundation
    func syncTimebase() {}
}

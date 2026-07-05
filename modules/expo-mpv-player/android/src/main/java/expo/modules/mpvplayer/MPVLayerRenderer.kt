package expo.modules.mpvplayer

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import `is`.xyz.mpv.MPVLib
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlin.math.log2

private const val TAG = "MPVLayerRenderer"

/**
 * Core mpv wrapper for Android. Owns the mpv lifecycle, observes properties,
 * and forwards state changes to its delegate on the main thread.
 */
class MPVLayerRenderer(private val context: Context) : MPVLib.EventObserver {

    interface Delegate {
        fun onPositionChanged(position: Double, duration: Double, cacheSeconds: Double)
        fun onPauseChanged(isPaused: Boolean)
        fun onLoadingChanged(isLoading: Boolean)
        fun onReadyToSeek()
        fun onTracksReady()
        fun onError(message: String)
        fun onVideoDimensionsChanged(width: Int, height: Int)
        fun onEOFChanged(eofReached: Boolean)
        fun onSpeedChanged(speed: Double)
        fun onSubtitleDelayChanged(delay: Double)
        fun onAudioDelayChanged(delay: Double)
    }

    var delegate: Delegate? = null

        // gpu-next toggle
    @Volatile
    private var useGpuNext: Boolean = true

    // cached state
    @Volatile
    var cachedPosition: Double = 0.0
    @Volatile
    var cachedDuration: Double = 0.0
    @Volatile
    var cachedCacheSeconds: Double = 0.0
    @Volatile
    var isPaused: Boolean = true
        private set
    @Volatile
    var isLoading: Boolean = false
        private set
    @Volatile
    var playbackSpeed: Double = 1.0
        private set
    @Volatile
    var isReadyToSeek: Boolean = false
        private set

    private var isSeeking = false
    private var videoWidth = 0
    private var videoHeight = 0
    private var requestedVideoZoomScale = 1.0

    // load state
    private var currentUrl: String? = null
    private var currentHeaders: Map<String, String>? = null
    private var pendingExternalSubtitles: List<Pair<String, String?>>? = null

    // progress throttling
    private var lastProgressUpdateTime: Long = 0
    private val progressIntervalMs: Long = 1000

    private var initialized = false
    private var surface: Surface? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    fun start() {
        if (initialized) return

        MPVLib.create(context)

        // video output — gpu-next (libplacebo) or legacy gpu
        if (useGpuNext) {
            MPVLib.setOptionString("vo", "gpu-next")
            MPVLib.setOptionString("gpu-context", "android")
            // opengl-es is not needed — gpu-next/libplacebo handles GL ES internally
        } else {
            MPVLib.setOptionString("vo", "gpu")
            MPVLib.setOptionString("gpu-context", "android")
            MPVLib.setOptionString("opengl-es", "yes")
        }

        // hardware decoding
        MPVLib.setOptionString("hwdec", "mediacodec-copy")
        MPVLib.setOptionString("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1")

        // cache & demuxer
        MPVLib.setOptionString("cache", "yes")
        MPVLib.setOptionString("cache-pause-initial", "yes")
        MPVLib.setOptionString("demuxer-max-bytes", "150MiB")
        MPVLib.setOptionString("demuxer-max-back-bytes", "75MiB")
        MPVLib.setOptionString("demuxer-readahead-secs", "20")

        // progressive streams should still accept range seeks when mpv cannot infer it
        MPVLib.setOptionString("demuxer-seekable-cache", "yes")
        MPVLib.setOptionString("force-seekable", "yes")

        // exact seeking avoids Android keyframe seeks replaying the same segment
        MPVLib.setOptionString("hr-seek", "yes")
        MPVLib.setOptionString("hr-seek-framedrop", "yes")

        // subtitles
        MPVLib.setOptionString("sub-scale-with-window", "no")
        MPVLib.setOptionString("sub-use-margins", "no")
        MPVLib.setOptionString("subs-match-os-language", "yes")
        MPVLib.setOptionString("subs-fallback", "yes")
        MPVLib.setOptionString("sub-auto", "fuzzy")
        MPVLib.setOptionString("sub-font-size", "48")
        MPVLib.setOptionString("sub-ass-override", "no")
        MPVLib.setOptionString("sub-ass-force-margins", "yes")

        // network reconnection
        MPVLib.setOptionString("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5")

        // playback behavior
        MPVLib.setOptionString("force-window", "no")
        MPVLib.setOptionString("keep-open", "always")

        // aspect ratio
        MPVLib.setOptionString("keepaspect", "yes")
        MPVLib.setOptionString("video-zoom", "0")

        // start paused
        MPVLib.setOptionString("pause", "yes")

        // config dir with subfont.ttf
        setupConfigDir()

        MPVLib.init()
        MPVLib.addObserver(this)
        observeProperties()

        initialized = true
        Log.d(TAG, "mpv started")
    }

    fun stop() {
        if (!initialized) return
        initialized = false
        MPVLib.removeObserver(this)
        try {
            MPVLib.command(arrayOf("stop"))
            MPVLib.detachSurface()
            MPVLib.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Error during mpv stop", e)
        }
        Log.d(TAG, "mpv stopped")
    }

    /**
     * Update the gpu-next preference and restart mpv with the new video output setting.
     * The current video will be reloaded automatically.
     */
    fun setUseGpuNext(enabled: Boolean, currentUrl: String?, currentHeaders: Map<String, String>?) {
        if (useGpuNext == enabled) return
        useGpuNext = enabled
        Log.i(TAG, "Switching vo: useGpuNext=$enabled")

        // Tear down
        if (initialized) {
            initialized = false
            MPVLib.removeObserver(this)
            try {
                MPVLib.command(arrayOf("stop"))
                MPVLib.detachSurface()
                MPVLib.destroy()
            } catch (e: Exception) {
                Log.w(TAG, "Error during mpv restart teardown", e)
            }
        }

        // Reinitialize with new options (start() calls MPVLib.create + init)
        start()

        // Re-attach surface if previously attached
        val s = surface
        if (s != null) {
            MPVLib.attachSurface(s)
            MPVLib.setPropertyString("force-window", "yes")
        }

        // Reload current video if one was playing
        if (!currentUrl.isNullOrBlank()) {
            val pos = cachedPosition
            if (pos > 0) {
                MPVLib.setPropertyString("start", formatMpvSeconds(pos))
            }
            if (!currentHeaders.isNullOrEmpty()) {
                val headerStr = currentHeaders.entries.joinToString("\r\n") { "${it.key}: ${it.value}" }
                MPVLib.setPropertyString("http-header-fields", headerStr)
            }
            MPVLib.command(arrayOf("loadfile", currentUrl, "replace"))
        }
    }

    // -------------------------------------------------------------------
    // Surface management (Findroid approach)
    // -------------------------------------------------------------------

    fun attachSurface(surface: Surface) {
        this.surface = surface
        Log.i(TAG, "[PiP] attachSurface — initialized=$initialized, surface=${surface.hashCode()}")
        if (initialized) {
            MPVLib.attachSurface(surface)
            MPVLib.setPropertyString("force-window", "yes")
            val activeVo = try {
                MPVLib.getPropertyString("vo")
            } catch (e: Exception) {
                null
            }
            Log.i(TAG, "[PiP] attachSurface — attached, activeVo=$activeVo")
        }
    }

    fun detachSurface() {
        this.surface = null
        Log.i(TAG, "[PiP] detachSurface — initialized=$initialized")
        if (initialized) {
            MPVLib.detachSurface()
            val activeVo = try {
                MPVLib.getPropertyString("vo")
            } catch (e: Exception) {
                null
            }
            Log.i(TAG, "[PiP] detachSurface — detached, activeVo=$activeVo (should still be gpu)")
        }
    }

    fun updateSurfaceSize(width: Int, height: Int) {
        if (initialized) {
            MPVLib.setPropertyString("android-surface-size", "${width}x$height")
            Log.i(TAG, "[PiP] updateSurfaceSize — ${width}x${height}")
        } else {
            Log.w(TAG, "[PiP] updateSurfaceSize — called but renderer not running")
        }
    }

    fun forceRedraw() {
        if (!initialized) return
        val pos = cachedPosition
        Log.i(TAG, "[PiP] forceRedraw — stepping frame then seeking to $pos")
        MPVLib.command(arrayOf("frame-step"))
        if (pos > 0) {
            MPVLib.command(arrayOf("seek", pos.toString(), "absolute"))
        }
    }

    // -------------------------------------------------------------------
    // Loading
    // -------------------------------------------------------------------

    fun load(
        url: String,
        headers: Map<String, String>?,
        startPosition: Double?,
        externalSubtitles: List<Pair<String, String?>>?
    ) {
        if (!initialized) return

        // stop any current playback
        MPVLib.command(arrayOf("stop"))

        // reset state
        cachedPosition = 0.0
        cachedDuration = 0.0
        cachedCacheSeconds = 0.0
        isReadyToSeek = false
        isSeeking = false
        isLoading = true
        mainHandler.post { delegate?.onLoadingChanged(true) }

        currentUrl = url
        currentHeaders = headers
        pendingExternalSubtitles = externalSubtitles

        // http headers
        if (!headers.isNullOrEmpty()) {
            val headerStr = headers.entries.joinToString("\r\n") { "${it.key}: ${it.value}" }
            MPVLib.setPropertyString("http-header-fields", headerStr)
        } else {
            MPVLib.setPropertyString("http-header-fields", "")
        }

        // start position
        if (startPosition != null && startPosition > 0) {
            MPVLib.setPropertyString("start", formatMpvSeconds(startPosition))
        } else {
            MPVLib.setPropertyString("start", "0")
        }

        // if external subs are pending, disable auto-selection until they're added on FILE_LOADED
        if (!externalSubtitles.isNullOrEmpty()) {
            MPVLib.setPropertyString("sid", "no")
        }

        MPVLib.setPropertyDouble("video-zoom", log2(requestedVideoZoomScale.coerceAtLeast(1.0)))

        MPVLib.command(arrayOf("loadfile", url, "replace"))
    }

    // -------------------------------------------------------------------
    // Playback controls
    // -------------------------------------------------------------------

    fun play() {
        if (!initialized) return
        MPVLib.setPropertyBoolean("pause", false)
    }

    fun pause() {
        if (!initialized) return
        MPVLib.setPropertyBoolean("pause", true)
    }

    fun togglePause() {
        if (!initialized) return
        val current = MPVLib.getPropertyBoolean("pause") ?: true
        MPVLib.setPropertyBoolean("pause", !current)
    }

    fun seekTo(seconds: Double) {
        if (!initialized) return
        if (!seconds.isFinite()) return
        val clamped = seconds.coerceAtLeast(0.0)
        // update cached position BEFORE issuing the command to prevent snap-back
        cachedPosition = clamped
        isSeeking = true
        MPVLib.command(arrayOf("seek", formatMpvSeconds(clamped), "absolute+exact"))
    }

    fun seekBy(seconds: Double) {
        if (!initialized) return
        if (!seconds.isFinite()) return
        val unclampedPosition = (cachedPosition + seconds).coerceAtLeast(0.0)
        val newPosition = if (cachedDuration > 0.0) {
            unclampedPosition.coerceAtMost(cachedDuration)
        } else {
            unclampedPosition
        }
        // update cached position BEFORE issuing the command to prevent snap-back
        cachedPosition = newPosition
        isSeeking = true
        MPVLib.command(arrayOf("seek", formatMpvSeconds(seconds), "relative+exact"))
    }

    fun setSpeed(speed: Double) {
        if (!initialized) return
        MPVLib.setPropertyDouble("speed", speed)
    }

    fun getSpeed(): Double {
        return playbackSpeed
    }

    // -------------------------------------------------------------------
    // Subtitle controls
    // -------------------------------------------------------------------

    fun getSubtitleTracks(): List<Map<String, Any>> {
        if (!initialized) return emptyList()
        val count = try {
            MPVLib.getPropertyInt("track-list/count") ?: 0
        } catch (_: Exception) {
            0
        }
        val tracks = mutableListOf<Map<String, Any>>()

        for (i in 0 until count) {
            val type = try {
                MPVLib.getPropertyString("track-list/$i/type")
            } catch (_: Exception) {
                null
            }
            if (type != "sub") continue

            val track = mutableMapOf<String, Any>()
            val id = try {
                MPVLib.getPropertyInt("track-list/$i/id")
            } catch (_: Exception) {
                null
            }
            track["id"] = id ?: continue

            track["title"] = try {
                MPVLib.getPropertyString("track-list/$i/title") ?: ""
            } catch (_: Exception) {
                ""
            }
            track["lang"] = try {
                MPVLib.getPropertyString("track-list/$i/lang") ?: ""
            } catch (_: Exception) {
                ""
            }
            val codec = try {
                MPVLib.getPropertyString("track-list/$i/codec")
            } catch (_: Exception) {
                null
            }
            if (!codec.isNullOrBlank()) {
                track["codec"] = codec
            }

            val selected = try {
                MPVLib.getPropertyBoolean("track-list/$i/selected") ?: false
            } catch (_: Exception) {
                false
            }
            track["selected"] = selected

            tracks.add(track)
        }
        return tracks
    }

    fun getChapters(): List<Map<String, Any>> {
        if (!initialized) return emptyList()
        val count = try {
            MPVLib.getPropertyInt("chapter-list/count") ?: 0
        } catch (_: Exception) {
            0
        }
        val chapters = mutableListOf<Map<String, Any>>()

        for (i in 0 until count) {
            val chapter = mutableMapOf<String, Any>()
            val title = try {
                MPVLib.getPropertyString("chapter-list/$i/title") ?: ""
            } catch (_: Exception) {
                ""
            }
            val time = try {
                MPVLib.getPropertyDouble("chapter-list/$i/time") ?: 0.0
            } catch (_: Exception) {
                0.0
            }
            chapter["title"] = title
            chapter["time"] = time
            chapter["id"] = i
            chapters.add(chapter)
        }
        return chapters
    }

    fun setSubtitleTrack(trackId: Int) {
        if (!initialized) return
        if (trackId == -1) {
            MPVLib.setPropertyString("sid", "no")
        } else {
            MPVLib.setPropertyString("sid", trackId.toString())
        }
    }

    fun disableSubtitles() {
        if (!initialized) return
        MPVLib.setPropertyString("sid", "no")
    }

    fun getCurrentSubtitleTrack(): Int {
        if (!initialized) return -1
        val value = try {
            MPVLib.getPropertyString("sid")
        } catch (_: Exception) {
            null
        }
        if (value != null && value != "no") {
            return value.toIntOrNull() ?: -1
        }
        return -1
    }

    fun addSubtitleFile(url: String, select: Boolean) {
        if (!initialized) return
        val flag = if (select) "select" else "cached"
        MPVLib.command(arrayOf("sub-add", url, flag))
    }

    fun setSubtitleDelay(delay: Double) {
        if (!initialized) return
        MPVLib.setPropertyDouble("sub-delay", delay)
    }

    fun setSubtitleFontSize(size: Int) {
        if (!initialized) return
        MPVLib.setPropertyString("sub-font-size", size.toString())
    }

    fun setSubtitleVisibility(visible: Boolean) {
        if (!initialized) return
        MPVLib.setPropertyString("sub-visibility", if (visible) "yes" else "no")
    }

    fun setSubtitlePosition(position: Int) {
        if (!initialized) return
        MPVLib.setPropertyInt("sub-pos", position.coerceIn(0, 100))
    }

    // -------------------------------------------------------------------
    // Audio controls
    // -------------------------------------------------------------------

    fun getAudioTracks(): List<Map<String, Any>> {
        if (!initialized) return emptyList()
        val count = try {
            MPVLib.getPropertyInt("track-list/count") ?: 0
        } catch (_: Exception) {
            0
        }
        val tracks = mutableListOf<Map<String, Any>>()

        for (i in 0 until count) {
            val type = try {
                MPVLib.getPropertyString("track-list/$i/type")
            } catch (_: Exception) {
                null
            }
            if (type != "audio") continue

            val track = mutableMapOf<String, Any>()
            val id = try {
                MPVLib.getPropertyInt("track-list/$i/id")
            } catch (_: Exception) {
                null
            }
            track["id"] = id ?: continue

            track["title"] = try {
                MPVLib.getPropertyString("track-list/$i/title") ?: ""
            } catch (_: Exception) {
                ""
            }
            track["lang"] = try {
                MPVLib.getPropertyString("track-list/$i/lang") ?: ""
            } catch (_: Exception) {
                ""
            }
            track["codec"] = try {
                MPVLib.getPropertyString("track-list/$i/codec") ?: ""
            } catch (_: Exception) {
                ""
            }

            val channels = try {
                MPVLib.getPropertyInt("track-list/$i/demux-channel-count")
            } catch (_: Exception) {
                null
            }
            if (channels != null) track["channels"] = channels

            val selected = try {
                MPVLib.getPropertyBoolean("track-list/$i/selected") ?: false
            } catch (_: Exception) {
                false
            }
            track["selected"] = selected

            tracks.add(track)
        }
        return tracks
    }

    fun setAudioTrack(trackId: Int) {
        if (!initialized) return
        MPVLib.setPropertyString("aid", trackId.toString())
    }

    fun getCurrentAudioTrack(): Int {
        if (!initialized) return -1
        val value = try {
            MPVLib.getPropertyString("aid")
        } catch (_: Exception) {
            null
        }
        if (value != null && value != "no") {
            return value.toIntOrNull() ?: -1
        }
        return -1
    }

    fun setAudioDelay(delay: Double) {
        if (!initialized) return
        MPVLib.setPropertyDouble("audio-delay", delay)
    }

    // -------------------------------------------------------------------
    // Zoom
    // -------------------------------------------------------------------

    fun setVideoZoom(scale: Double) {
        if (!initialized) return
        requestedVideoZoomScale = scale.coerceAtLeast(1.0)
        MPVLib.setPropertyDouble("video-zoom", log2(requestedVideoZoomScale))
    }

    fun setZoomedToFill(zoomed: Boolean) {
        if (!initialized) return
        // panscan: 0.0 = fit (letterboxed), 1.0 = fill (cropped)
        MPVLib.setPropertyDouble("panscan", if (zoomed) 1.0 else 0.0)
    }

    // -------------------------------------------------------------------
    // Technical info
    // -------------------------------------------------------------------

    fun getTechnicalInfo(): Map<String, Any> {
        if (!initialized) return emptyMap()
        val info = mutableMapOf<String, Any>()

        try {
            MPVLib.getPropertyInt("video-params/w")?.let { info["videoWidth"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyInt("video-params/h")?.let { info["videoHeight"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyString("video-codec")?.let { info["videoCodec"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyString("audio-codec-name")?.let { info["audioCodec"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyDouble("estimated-vf-fps")?.let { info["fps"] = it }
        } catch (_: Exception) {
        }
        info["cacheSeconds"] = cachedCacheSeconds
        try {
            MPVLib.getPropertyInt("frame-drop-count")?.let { info["droppedFrames"] = it }
        } catch (_: Exception) {
        }

        return info
    }

    // -------------------------------------------------------------------
    // MPVLib.EventObserver — property callbacks
    // -------------------------------------------------------------------

    override fun eventProperty(property: String) {
        // no-value change, ignored
    }

    override fun eventProperty(property: String, value: Long) {
        when (property) {
            "track-list/count" -> {
                mainHandler.post { delegate?.onTracksReady() }
            }

            "video-params/w" -> {
                videoWidth = value.toInt()
                if (videoWidth > 0 && videoHeight > 0) {
                    val w = videoWidth
                    val h = videoHeight
                    mainHandler.post { delegate?.onVideoDimensionsChanged(w, h) }
                }
            }

            "video-params/h" -> {
                videoHeight = value.toInt()
                if (videoWidth > 0 && videoHeight > 0) {
                    val w = videoWidth
                    val h = videoHeight
                    mainHandler.post { delegate?.onVideoDimensionsChanged(w, h) }
                }
            }
        }
    }

    override fun eventProperty(property: String, value: Boolean) {
        when (property) {
            "pause" -> {
                isPaused = value
                mainHandler.post { delegate?.onPauseChanged(value) }
            }

            "paused-for-cache" -> {
                isLoading = value
                mainHandler.post { delegate?.onLoadingChanged(value) }
            }

            "eof-reached" -> {
                mainHandler.post { delegate?.onEOFChanged(value) }
            }
        }
    }

    override fun eventProperty(property: String, value: Double) {
        when (property) {
            "time-pos" -> {
                cachedPosition = value
                val now = System.currentTimeMillis()
                // throttle to ~1 update/sec unless seeking
                if (isSeeking || (now - lastProgressUpdateTime >= progressIntervalMs)) {
                    lastProgressUpdateTime = now
                    val pos = cachedPosition
                    val dur = cachedDuration
                    val cache = cachedCacheSeconds
                    mainHandler.post { delegate?.onPositionChanged(pos, dur, cache) }
                }
            }

            "duration" -> {
                cachedDuration = value
            }

            "speed" -> {
                playbackSpeed = value
                mainHandler.post { delegate?.onSpeedChanged(value) }
            }

            "sub-delay" -> {
                mainHandler.post { delegate?.onSubtitleDelayChanged(value) }
            }

            "audio-delay" -> {
                mainHandler.post { delegate?.onAudioDelayChanged(value) }
            }

            "demuxer-cache-duration" -> {
                cachedCacheSeconds = value
            }
        }
    }

    override fun eventProperty(property: String, value: String) {
        when (property) {
            "sid", "aid" -> {
                mainHandler.post { delegate?.onTracksReady() }
            }
        }
    }

    // -------------------------------------------------------------------
    // MPVLib.EventObserver — event callbacks
    // -------------------------------------------------------------------

    override fun event(eventId: Int) {
        when (eventId) {
            MPVLib.MpvEvent.MPV_EVENT_FILE_LOADED -> {
                MPVLib.setPropertyDouble("video-zoom", log2(requestedVideoZoomScale.coerceAtLeast(1.0)))
                isLoading = false
                isReadyToSeek = true
                mainHandler.post {
                    delegate?.onLoadingChanged(false)
                    delegate?.onReadyToSeek()
                }

                // add pending external subtitles now that the file is loaded
                val subs = pendingExternalSubtitles
                if (subs != null) {
                    for ((index, sub) in subs.withIndex()) {
                        val flag = if (index == 0) "select" else "cached"
                        val title = sub.second
                        if (title != null && title.isNotEmpty()) {
                            MPVLib.command(arrayOf("sub-add", sub.first, flag, title))
                        } else {
                            MPVLib.command(arrayOf("sub-add", sub.first, flag))
                        }
                    }
                    pendingExternalSubtitles = null
                }
            }

            MPVLib.MpvEvent.MPV_EVENT_SEEK -> {
                isSeeking = true
                isLoading = true
                mainHandler.post { delegate?.onLoadingChanged(true) }
            }

            MPVLib.MpvEvent.MPV_EVENT_PLAYBACK_RESTART -> {
                MPVLib.setPropertyDouble("video-zoom", log2(requestedVideoZoomScale.coerceAtLeast(1.0)))
                isSeeking = false
                isLoading = false
                mainHandler.post { delegate?.onLoadingChanged(false) }
            }

            MPVLib.MpvEvent.MPV_EVENT_END_FILE -> {
                Log.d(TAG, "end file event")
            }

            MPVLib.MpvEvent.MPV_EVENT_SHUTDOWN -> {
                Log.d(TAG, "mpv shutdown event")
            }
        }
    }

    // -------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------

    private fun observeProperties() {
        MPVLib.observeProperty("duration", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("time-pos", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("pause", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("track-list/count", MPVLib.MpvFormat.MPV_FORMAT_INT64)
        MPVLib.observeProperty("sid", MPVLib.MpvFormat.MPV_FORMAT_STRING)
        MPVLib.observeProperty("aid", MPVLib.MpvFormat.MPV_FORMAT_STRING)
        MPVLib.observeProperty("paused-for-cache", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("demuxer-cache-duration", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("video-params/w", MPVLib.MpvFormat.MPV_FORMAT_INT64)
        MPVLib.observeProperty("video-params/h", MPVLib.MpvFormat.MPV_FORMAT_INT64)
        MPVLib.observeProperty("eof-reached", MPVLib.MpvFormat.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("speed", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("sub-delay", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("audio-delay", MPVLib.MpvFormat.MPV_FORMAT_DOUBLE)
    }

    private fun setupConfigDir() {
        val mpvDir = File(context.filesDir, "mpv")
        if (!mpvDir.exists()) mpvDir.mkdirs()

        // copy subfont.ttf from assets if available
        try {
            val input = context.assets.open("subfont.ttf")
            val output = FileOutputStream(File(mpvDir, "subfont.ttf"))
            input.copyTo(output)
            input.close()
            output.close()
        } catch (_: Exception) {
            // asset not bundled, skip
        }

        MPVLib.setOptionString("config", "yes")
        MPVLib.setOptionString("config-dir", mpvDir.path)
    }

    private fun formatMpvSeconds(seconds: Double): String {
        return String.format(Locale.US, "%.3f", seconds)
    }
}

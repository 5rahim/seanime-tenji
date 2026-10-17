package expo.modules.mpvplayer

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.system.Os
import android.util.Log
import android.view.Surface
import `is`.xyz.mpv.MPVLib
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlin.math.log2

private const val TAG = "MPVLayerRenderer"

enum class VideoOutput(val mpvValue: String) {
    GPU_NEXT("gpu-next"),
    GPU("gpu");

    companion object {
        fun fromMpvValue(value: String): VideoOutput? = entries.firstOrNull { it.mpvValue == value }
    }
}

/**
 * Core mpv wrapper for Android. Owns the mpv lifecycle, observes properties,
 * and forwards state changes to its delegate on the main thread.
 */
class MPVLayerRenderer(private val context: Context) : MPVLib.EventObserver, MPVLib.LogObserver {

    private fun isTvDevice(): Boolean {
        val manager = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        return manager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }

    private fun isEmulator(): Boolean {
        val hardware = Build.HARDWARE.lowercase()
        if (hardware == "goldfish" || hardware == "ranchu") return true

        val product = Build.PRODUCT
        if (product == "sdk" || product.startsWith("sdk_")) return true

        val fingerprint = Build.FINGERPRINT
        return fingerprint.startsWith("generic")
            || fingerprint.contains("emulator", ignoreCase = true)
    }

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
    private var activeExternalSubtitles: List<Pair<String, String?>> = emptyList()
    private var restoreAudioId: Int? = null
    private var restoreSubtitleId: Int? = null

    // progress throttling
    private var lastProgressUpdateTime: Long = 0
    private val progressIntervalMs: Long = 1000

    private var initialized = false
    private var surface: Surface? = null

    @Volatile
    private var videoOutput: VideoOutput = VideoOutput.GPU_NEXT
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile
    private var statsLogged = false
    private val statsTask = Runnable {
        if (!initialized || statsLogged || currentUrl == null) return@Runnable
        statsLogged = true
        logStats()
    }

    val isTv: Boolean = isTvDevice()
    private val emulator: Boolean = isEmulator()
    private val requestedHwdec: String = when {
        emulator -> "no"
        isTv -> "mediacodec,mediacodec-copy"
        else -> "mediacodec-copy"
    }
    @Volatile
    private var hwdecResult: Int? = null
    @Volatile
    private var decoderError: String? = null

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    fun start() {
        if (initialized) return

        setupEnv()
        MPVLib.create(context)
        MPVLib.addLogObserver(this)

        // video output
        MPVLib.setOptionString("vo", videoOutput.mpvValue)
        MPVLib.setOptionString("gpu-context", "android")
        MPVLib.setOptionString("opengl-es", "yes")

        // hardware decoding
        MPVLib.setOptionString("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1")
        when {
            emulator -> hwdecResult = MPVLib.setOptionString("hwdec", requestedHwdec)
            isTv -> {
                hwdecResult = MPVLib.setOptionString("hwdec", requestedHwdec)
                MPVLib.setOptionString("profile", "fast")
                MPVLib.setOptionString("demuxer-seekable-cache", "no")
                MPVLib.setOptionString("audio-buffer", "0.5")
            }
            else -> {
                hwdecResult = MPVLib.setOptionString("hwdec", requestedHwdec)
                MPVLib.setOptionString("demuxer-seekable-cache", "yes")
            }
        }

        // cache & demuxer
        MPVLib.setOptionString("cache", "auto")
        // On Android TV, give up on a stalled network read after a few seconds and reconnect
        // (see the lavf:// note in load()) instead of leaving playback stuck on the spinner.
        if (isTv) MPVLib.setOptionString("network-timeout", "5")
        MPVLib.setOptionString("cache-secs", "10")
        MPVLib.setOptionString("cache-pause-initial", "yes")
        MPVLib.setOptionString("demuxer-max-bytes", if (isTv) "75MiB" else "150MiB")
        MPVLib.setOptionString("demuxer-max-back-bytes", if (isTv) "30MiB" else "50MiB")

        // progressive streams should still accept range seeks when mpv cannot infer it
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
        Log.i(
            TAG,
            "mpv started — tv=$isTv, emulator=$emulator, requestedHwdec=$requestedHwdec, hwdecResult=$hwdecResult, requestedVo=${videoOutput.mpvValue}, activeVo=${getActiveVideoOutput()}"
        )
    }

    fun stop() {
        if (!initialized) return
        initialized = false
        mainHandler.removeCallbacks(statsTask)
        statsLogged = false
        MPVLib.removeObserver(this)
        MPVLib.removeLogObserver(this)
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
     * Changes only mpv's video output. Recreating mpv here would discard the
     * active source, playback position, selected tracks, and other live state.
     */
    fun setVideoOutput(output: VideoOutput) {
        if (videoOutput == output) return

        val previous = videoOutput
        videoOutput = output

        if (!initialized) {
            Log.i(TAG, "Video output staged — from=${previous.mpvValue}, requestedVo=${output.mpvValue}")
            return
        }

        Log.i(TAG, "Switching video output — from=${previous.mpvValue}, requestedVo=${output.mpvValue}")
        try {
            MPVLib.setPropertyString("vo", output.mpvValue)
            Log.i(TAG, "Video output switched — requestedVo=${output.mpvValue}, activeVo=${getActiveVideoOutput()}")
        } catch (e: Exception) {
            videoOutput = previous
            Log.e(TAG, "Failed to switch video output to ${output.mpvValue}", e)
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
            Log.i(TAG, "[PiP] attachSurface — attached, activeVo=${getActiveVideoOutput()}")
        }
    }

    fun detachSurface() {
        this.surface = null
        Log.i(TAG, "[PiP] detachSurface — initialized=$initialized")
        if (initialized) {
            MPVLib.detachSurface()
            Log.i(TAG, "[PiP] detachSurface — detached, activeVo=${getActiveVideoOutput()}")
        }
    }

    private fun getActiveVideoOutput(): String? {
        if (!initialized) return videoOutput.mpvValue
        return try {
            MPVLib.getPropertyString("vo")
        } catch (_: Exception) {
            null
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

    fun recoverVideoOutput(surface: Surface?, playWhenReady: Boolean = false): Boolean {
        if (!initialized) return false
        val url = currentUrl ?: return false
        val position = cachedPosition
        val audioId = getCurrentAudioTrack()
        val subtitleId = getCurrentSubtitleTrack()

        Log.i(
            TAG,
            "[Recover] reload — pos=$position, aid=$audioId, sid=$subtitleId, play=$playWhenReady",
        )

        surface?.takeIf { it.isValid }?.let { attachSurface(it) }
        load(
            url = url,
            headers = currentHeaders,
            startPosition = position,
            externalSubtitles = activeExternalSubtitles,
            audioId = audioId,
            subtitleId = subtitleId
        )
        if (playWhenReady) play() else pause()
        return true
    }

    // -------------------------------------------------------------------
    // Loading
    // -------------------------------------------------------------------

    fun load(
        url: String,
        headers: Map<String, String>?,
        startPosition: Double?,
        externalSubtitles: List<Pair<String, String?>>?,
        audioId: Int? = null,
        subtitleId: Int? = null
    ) {
        if (!initialized) return

        // stop any current playback
        MPVLib.command(arrayOf("stop"))
        decoderError = null

        // reset state
        cachedPosition = 0.0
        cachedDuration = 0.0
        cachedCacheSeconds = 0.0
        isReadyToSeek = false
        isSeeking = false
        isLoading = true
        statsLogged = false
        mainHandler.removeCallbacks(statsTask)
        mainHandler.post { delegate?.onLoadingChanged(true) }

        currentUrl = url
        currentHeaders = headers
        pendingExternalSubtitles = externalSubtitles
        activeExternalSubtitles = externalSubtitles ?: emptyList()
        restoreAudioId = audioId
        restoreSubtitleId = subtitleId

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

        // On Android TV, open http(s) sources through FFmpeg's protocol (lavf://). On the Shield, mpv's
        // libcurl stream could stall indefinitely after a couple of quick seeks; FFmpeg's reader honours
        // network-timeout and reconnects.
        val loadUrl = if (isTv && (url.startsWith("http://") || url.startsWith("https://"))) "lavf://$url" else url
        MPVLib.command(arrayOf("loadfile", loadUrl, "replace"))
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
        val flag = if (select) "select" else "auto"
        MPVLib.command(arrayOf("sub-add", url, flag))
        if (activeExternalSubtitles.none { it.first == url }) {
            activeExternalSubtitles = activeExternalSubtitles + Pair(url, null)
        }
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
        try {
            MPVLib.getPropertyDouble("display-fps")?.let { info["displayFps"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyInt("video-bitrate")?.let { info["videoBitrate"] = it }
        } catch (_: Exception) {
        }
        info["cacheSeconds"] = cachedCacheSeconds
        try {
            MPVLib.getPropertyInt("frame-drop-count")?.let { info["droppedFrames"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyInt("decoder-frame-drop-count")?.let { info["decoderDroppedFrames"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyBoolean("paused-for-cache")?.let { info["isBuffering"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyDouble("cache-secs")?.let { info["cacheLimit"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyInt("demuxer-max-bytes")?.let { info["maxCacheMiB"] = it / (1024 * 1024) }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyInt("demuxer-max-back-bytes")?.let { info["backCacheMiB"] = it / (1024 * 1024) }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyString("vo")?.let { info["voDriver"] = it }
        } catch (_: Exception) {
        }
        try {
            MPVLib.getPropertyString("hwdec-current")?.let { info["hwdec"] = it }
        } catch (_: Exception) {
        }
        info["requestedHwdec"] = requestedHwdec
        hwdecResult?.let { info["hwdecOptionResult"] = it }
        decoderError?.let { info["decoderError"] = it }
        try {
            MPVLib.getPropertyString("video-params/hw-pixelformat")?.let { info["hwPixelFormat"] = it }
        } catch (_: Exception) {
        }

        return info
    }

    override fun logMessage(prefix: String, level: Int, text: String) {
        if (level > MPVLib.MpvLogLevel.MPV_LOG_LEVEL_WARN) return

        val source = prefix.lowercase(Locale.ROOT)
        val message = text.replace(Regex("\\s+"), " ").trim()
        val lower = message.lowercase(Locale.ROOT)
        val decoderRelated = (
            source == "vd"
                || source == "ffmpeg"
                || source.startsWith("vo/")
                || lower.contains("mediacodec")
                || lower.contains("hwdec")
                || lower.contains("decoder")
            )

        if (!decoderRelated || message.isEmpty()) return

        val entry = "$prefix: $message".take(360)
        decoderError = entry
        Log.w(TAG, "[mpv decoder] $entry")
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

            "hwdec-current" -> scheduleStats(500)
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
                scheduleStats(1500)
                mainHandler.post {
                    delegate?.onLoadingChanged(false)
                    delegate?.onReadyToSeek()
                }

                // add pending external subtitles now that the file is loaded
                val subs = pendingExternalSubtitles
                if (subs != null) {
                    for (sub in subs) {
                        val title = sub.second
                        if (title != null && title.isNotEmpty()) {
                            MPVLib.command(arrayOf("sub-add", sub.first, "auto", title))
                        } else {
                            MPVLib.command(arrayOf("sub-add", sub.first, "auto"))
                        }
                    }
                    pendingExternalSubtitles = null
                }

                restoreAudioId?.let { id ->
                    if (id >= 0) setAudioTrack(id)
                }
                restoreSubtitleId?.let { id ->
                    if (id >= 0) setSubtitleTrack(id) else disableSubtitles()
                }
                restoreAudioId = null
                restoreSubtitleId = null
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
        MPVLib.observeProperty("hwdec-current", MPVLib.MpvFormat.MPV_FORMAT_STRING)
    }

    private fun setupEnv() {
        try {
            val home = context.filesDir.absolutePath
            Os.setenv("XDG_CACHE_HOME", context.cacheDir.absolutePath, true)
            Os.setenv("XDG_CONFIG_HOME", home, true)
            Os.setenv("HOME", home, true)
        } catch (error: Exception) {
            Log.w(TAG, "Could not configure font cache", error)
        }
    }

    private fun scheduleStats(delayMs: Long) {
        if (statsLogged) return
        mainHandler.removeCallbacks(statsTask)
        mainHandler.postDelayed(statsTask, delayMs)
    }

    private fun logStats() {
        fun str(name: String): String? = try {
            MPVLib.getPropertyString(name)
        } catch (_: Exception) {
            null
        }

        fun int(name: String): Int? = try {
            MPVLib.getPropertyInt(name)
        } catch (_: Exception) {
            null
        }

        fun dbl(name: String): Double? = try {
            MPVLib.getPropertyDouble(name)
        } catch (_: Exception) {
            null
        }

        fun flag(name: String): Boolean? = try {
            MPVLib.getPropertyBoolean(name)
        } catch (_: Exception) {
            null
        }

        val mib = 1024 * 1024
        val max = int("demuxer-max-bytes")?.div(mib)
        val back = int("demuxer-max-back-bytes")?.div(mib)
        val size = "${int("video-params/w") ?: videoWidth}x${int("video-params/h") ?: videoHeight}"

        Log.i(
            TAG,
            "[Stats] tv=$isTv, codec=${str("video-codec")}, size=$size, fps=${dbl("estimated-vf-fps")}, " +
                "displayFps=${dbl("display-fps")}, hwdec=${str("hwdec-current") ?: "unknown"}, " +
                "hwFormat=${str("video-params/hw-pixelformat")}, vo=${str("vo")}, " +
                "dropped=${int("frame-drop-count")}, decoderDropped=${int("decoder-frame-drop-count")}, " +
                "buffering=${flag("paused-for-cache")}, cache=${dbl("demuxer-cache-duration")}, " +
                "cacheLimit=${dbl("cache-secs")}, maxMiB=$max, backMiB=$back"
        )
    }

    private fun setupConfigDir() {
        val mpvDir = File(context.filesDir, "mpv")
        if (!mpvDir.exists()) mpvDir.mkdirs()

        val target = File(mpvDir, "subfont.ttf")
        if (target.isFile && target.length() > 0) {
            MPVLib.setOptionString("config", "yes")
            MPVLib.setOptionString("config-dir", mpvDir.path)
            return
        }

        var copied = false
        try {
            context.assets.open("subfont.ttf").use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            }
            copied = true
        } catch (_: Exception) {
        }

        if (!copied) {
            val font = listOf(
                "/system/fonts/DroidSansFallback.ttf",
                "/system/fonts/NotoSansCJK-Regular.ttc",
                "/system/fonts/NotoSansCJK-VF.ttf",
                "/system/fonts/NotoSans-Regular.ttf",
                "/system/fonts/Roboto-Regular.ttf",
                "/system/fonts/DroidSans.ttf"
            ).map(::File).firstOrNull { it.isFile && it.canRead() }

            if (font != null) {
                try {
                    font.inputStream().use { input ->
                        FileOutputStream(target).use { output -> input.copyTo(output) }
                    }
                    copied = true
                } catch (error: Exception) {
                    Log.w(TAG, "Failed to install subtitle font", error)
                }
            }
        }

        if (!copied) {
            Log.w(TAG, "No subtitle font was available for text subtitles")
        }

        MPVLib.setOptionString("config", "yes")
        MPVLib.setOptionString("config-dir", mpvDir.path)
    }

    private fun formatMpvSeconds(seconds: Double): String {
        return String.format(Locale.US, "%.3f", seconds)
    }
}

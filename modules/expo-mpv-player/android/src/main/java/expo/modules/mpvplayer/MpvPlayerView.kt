/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Inspired by and/or derived from Streamyfin (https://github.com/streamyfin/streamyfin)
 * and Findroid (https://github.com/findroid/findroid).
 * Copyright (c) the original authors and Seanime Tenji contributors.
 */

package expo.modules.mpvplayer

import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

private const val TAG = "MpvPlayerView"

data class VideoLoadConfig(
    val url: String,
    val headers: Map<String, String>? = null,
    val externalSubtitles: List<Pair<String, String?>>? = null,
    val startPosition: Double? = null,
    val autoplay: Boolean = true
)

class MpvPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
    MPVLayerRenderer.Delegate, TextureView.SurfaceTextureListener, PiPController.Delegate {

    val onLoad by EventDispatcher()
    val onPlaybackStateChange by EventDispatcher()
    val onProgress by EventDispatcher()
    val onError by EventDispatcher()
    val onTracksReady by EventDispatcher()
    val onPictureInPictureChange by EventDispatcher()

    private var textureView: TextureView
    private var renderer: MPVLayerRenderer? = null
    private var pipController: PiPController? = null

    private var currentUrl: String? = null
    private var cachedPosition: Double = 0.0
    private var cachedDuration: Double = 0.0
    private var intendedPlayState: Boolean = false
    private var surfaceReady: Boolean = false
    private var pendingConfig: VideoLoadConfig? = null
    private var pendingVideoOutput: VideoOutput? = null
    private var canApplyPendingSource: Boolean = false
    private var _isZoomedToFill: Boolean = false
    private var dispatchedPiPActive: Boolean = false
    private var dispatchedPaused: Boolean? = null

    private var rendererStarted: Boolean = false
    private var pendingSurface: Surface? = null
    private var surfaceTexture: SurfaceTexture? = null
    private var surfaceWidth: Int = 0
    private var surfaceHeight: Int = 0

    private var isWaitingForPiPTransition: Boolean = false
    private var isPiPSurfaceForced: Boolean = false
    private val pipHandler = Handler(Looper.getMainLooper())
    private val redrawRunnable = Runnable {
        renderer?.forceRedraw()
    }

    init {
        setBackgroundColor(Color.BLACK)

        textureView = TextureView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            surfaceTextureListener = this@MpvPlayerView
        }
        addView(textureView)

        renderer = MPVLayerRenderer(context).also {
            it.delegate = this
        }

        pipController = PiPController(context, appContext).also {
            it.setPlayerView(textureView)
            it.delegate = this
        }
    }

    override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        this.surfaceTexture = surfaceTexture
        val surface = Surface(surfaceTexture)
        surfaceTexture.setDefaultBufferSize(width, height)
        surfaceReady = true
        surfaceWidth = width
        surfaceHeight = height

        if (rendererStarted) {
            renderer?.attachSurface(surface)
            renderer?.updateSurfaceSize(width, height)
        } else {
            pendingSurface = surface
        }

        applyPendingSourceR()
    }

    override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        surfaceTexture.setDefaultBufferSize(width, height)
        surfaceWidth = width
        surfaceHeight = height
        renderer?.updateSurfaceSize(width, height)
    }

    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        this.surfaceTexture = null
        surfaceReady = false
        surfaceWidth = 0
        surfaceHeight = 0
        pendingSurface?.release()
        pendingSurface = null
        renderer?.detachSurface()
        return false
    }

    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {}

    fun stageVideoOutput(value: String) {
        val output = VideoOutput.fromMpvValue(value)
        if (output == null) {
            Log.w(TAG, "Ignoring unsupported video output: $value")
            return
        }
        pendingVideoOutput = output
    }

    fun stageVideo(config: VideoLoadConfig) {
        if (config.url == currentUrl || config.url == pendingConfig?.url) return
        pendingConfig = config
        canApplyPendingSource = false
    }

    fun applyPendingProps() {
        pendingVideoOutput?.let { output ->
            pendingVideoOutput = null
            renderer?.setVideoOutput(output)
        }

        if (!rendererStarted) {
            renderer?.start()
            rendererStarted = true
            pendingSurface?.let { surface ->
                pendingSurface = null
                renderer?.attachSurface(surface)
                renderer?.updateSurfaceSize(surfaceWidth, surfaceHeight)
            }
        }

        canApplyPendingSource = true
        applyPendingSourceR()
    }

    private fun applyPendingSourceR() {
        if (!surfaceReady || !canApplyPendingSource) return
        val config = pendingConfig ?: return
        pendingConfig = null
        loadVideoInternal(config)
    }

    private fun loadVideoInternal(config: VideoLoadConfig) {
        currentUrl = config.url
        cachedPosition = 0.0
        cachedDuration = 0.0
        dispatchedPaused = null

        renderer?.load(
            url = config.url,
            headers = config.headers,
            startPosition = config.startPosition,
            externalSubtitles = config.externalSubtitles
        )

        if (config.autoplay) {
            play()
        }

        onLoad(mapOf("url" to config.url))
    }

    fun play() {
        intendedPlayState = true
        renderer?.play()
        pipController?.setPlaybackRate(1.0)
        dispatchPauseState(false)
    }

    fun pause() {
        intendedPlayState = false
        renderer?.pause()
        pipController?.setPlaybackRate(0.0)
        dispatchPauseState(true)
    }

    fun seekTo(position: Double) {
        cachedPosition = position
        renderer?.seekTo(position)
    }

    fun seekBy(offset: Double) {
        renderer?.seekBy(offset)
    }

    fun setSpeed(speed: Double) {
        renderer?.setSpeed(speed)
    }

    fun getSpeed(): Double {
        return renderer?.getSpeed() ?: 1.0
    }

    fun isPaused(): Boolean {
        return renderer?.isPaused ?: true
    }

    fun getCurrentPosition(): Double {
        return renderer?.cachedPosition ?: cachedPosition
    }

    fun getDuration(): Double {
        return renderer?.cachedDuration ?: cachedDuration
    }

    fun startPictureInPicture(): Boolean {
        isWaitingForPiPTransition = true
        val started = pipController?.startPictureInPicture() != null
        dispatchPictureInPictureState(started || isPictureInPictureActive())

        pipHandler.removeCallbacksAndMessages(null)
        for (delay in longArrayOf(500, 1000, 1500, 2000)) {
            pipHandler.postDelayed({ forcePiPBufferSize() }, delay)
        }
        return started
    }

    private fun forcePiPBufferSize() {
        if (!isWaitingForPiPTransition || !surfaceReady) return

        val rect = Rect()
        textureView.getGlobalVisibleRect(rect)
        val visW = rect.width()
        val visH = rect.height()
        val vw = textureView.width
        val vh = textureView.height

        if (visW <= 0 || visH <= 0 || (vw == visW && vh == visH)) return

        surfaceTexture?.setDefaultBufferSize(visW, visH)
        renderer?.updateSurfaceSize(visW, visH)

        textureView.measure(
            View.MeasureSpec.makeMeasureSpec(visW, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(visH, View.MeasureSpec.EXACTLY)
        )
        textureView.layout(0, 0, visW, visH)
        isPiPSurfaceForced = true
    }

    private fun restoreFromPiP() {
        if (!isPiPSurfaceForced) return
        isPiPSurfaceForced = false

        val lp = textureView.layoutParams
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT
        lp.height = ViewGroup.LayoutParams.MATCH_PARENT
        textureView.layoutParams = lp
        requestLayout()

        pipHandler.postDelayed({
            renderer?.forceRedraw()
        }, 100)
    }

    fun stopPictureInPicture() {
        isWaitingForPiPTransition = false
        pipHandler.removeCallbacksAndMessages(null)
        pipController?.stopPictureInPicture()
    }

    fun isPictureInPictureSupported(): Boolean {
        return pipController?.isPictureInPictureSupported() ?: false
    }

    fun isPictureInPictureActive(): Boolean {
        return pipController?.isPictureInPictureActive() ?: false
    }

    fun dispatchPictureInPictureState(active: Boolean) {
        if (dispatchedPiPActive == active) return
        dispatchedPiPActive = active
        onPlaybackStateChange(mapOf("isPiPActive" to active))
    }

    fun getSubtitleTracks(): List<Map<String, Any>> {
        return renderer?.getSubtitleTracks() ?: emptyList()
    }

    fun getChapters(): List<Map<String, Any>> {
        return renderer?.getChapters() ?: emptyList()
    }

    fun setSubtitleTrack(trackId: Int) {
        renderer?.setSubtitleTrack(trackId)
    }

    fun disableSubtitles() {
        renderer?.disableSubtitles()
    }

    fun getCurrentSubtitleTrack(): Int {
        return renderer?.getCurrentSubtitleTrack() ?: -1
    }

    fun addSubtitleFile(url: String, select: Boolean) {
        renderer?.addSubtitleFile(url, select)
    }

    fun setSubtitleDelay(delay: Double) {
        renderer?.setSubtitleDelay(delay)
    }

    fun setSubtitleFontSize(size: Int) {
        renderer?.setSubtitleFontSize(size)
    }

    fun setSubtitleVisibility(visible: Boolean) {
        renderer?.setSubtitleVisibility(visible)
    }

    fun setSubtitlePosition(position: Int) {
        renderer?.setSubtitlePosition(position)
    }

    fun getAudioTracks(): List<Map<String, Any>> {
        return renderer?.getAudioTracks() ?: emptyList()
    }

    fun setAudioTrack(trackId: Int) {
        renderer?.setAudioTrack(trackId)
    }

    fun getCurrentAudioTrack(): Int {
        return renderer?.getCurrentAudioTrack() ?: -1
    }

    fun setAudioDelay(delay: Double) {
        renderer?.setAudioDelay(delay)
    }

    fun setVideoZoom(scale: Double) {
        renderer?.setVideoZoom(scale)
    }

    fun setZoomedToFill(zoomed: Boolean) {
        _isZoomedToFill = zoomed
        renderer?.setZoomedToFill(zoomed)
    }

    fun isZoomedToFill(): Boolean {
        return _isZoomedToFill
    }

    fun getTechnicalInfo(): Map<String, Any> {
        return renderer?.getTechnicalInfo() ?: emptyMap()
    }

    fun getPlayerView(): android.view.View = textureView

    override fun onPositionChanged(position: Double, duration: Double, cacheSeconds: Double) {
        cachedPosition = position
        cachedDuration = duration

        if (pipController?.isPictureInPictureActive() == true) {
            pipController?.setCurrentTime(position, duration)
        }

        onProgress(
            mapOf(
                "position" to position,
                "duration" to duration,
                "cacheSeconds" to cacheSeconds
            )
        )
    }

    override fun onPauseChanged(isPaused: Boolean) {
        pipController?.setPlaybackRate(if (isPaused) 0.0 else 1.0)
        dispatchPauseState(isPaused)
    }

    private fun dispatchPauseState(isPaused: Boolean) {
        if (dispatchedPaused == isPaused) return
        dispatchedPaused = isPaused
        onPlaybackStateChange(
            mapOf(
                "isPaused" to isPaused,
                "isPlaying" to !isPaused
            )
        )
    }

    override fun onLoadingChanged(isLoading: Boolean) {
        onPlaybackStateChange(
            mapOf(
                "isLoading" to isLoading
            )
        )
    }

    override fun onReadyToSeek() {
        onPlaybackStateChange(
            mapOf(
                "isReadyToSeek" to true
            )
        )
    }

    override fun onTracksReady() {
        onTracksReady(emptyMap<String, Any>())
    }

    override fun onVideoDimensionsChanged(width: Int, height: Int) {
        pipController?.setVideoDimensions(width, height)
    }

    override fun onEOFChanged(eofReached: Boolean) {
        onPlaybackStateChange(
            mapOf(
                "eofReached" to eofReached
            )
        )
    }

    override fun onSpeedChanged(speed: Double) {
        onPlaybackStateChange(
            mapOf(
                "speed" to speed
            )
        )
    }

    override fun onSubtitleDelayChanged(delay: Double) {
        onPlaybackStateChange(
            mapOf(
                "subtitleDelay" to delay
            )
        )
    }

    override fun onAudioDelayChanged(delay: Double) {
        onPlaybackStateChange(
            mapOf(
                "audioDelay" to delay
            )
        )
    }

    override fun onError(message: String) {
        onError(
            mapOf(
                "error" to message
            )
        )
    }

    override fun onPlay() {
        play()
    }

    override fun onPause() {
        pause()
    }

    override fun onSeekBy(seconds: Double) {
        seekBy(seconds)
    }

    override fun onPictureInPictureModeChanged(isInPiP: Boolean) {
        if (isInPiP) {
            if (!isWaitingForPiPTransition) {
                isWaitingForPiPTransition = true
                pipHandler.removeCallbacksAndMessages(null)
                for (delay in longArrayOf(500, 1000, 1500, 2000)) {
                    pipHandler.postDelayed({ forcePiPBufferSize() }, delay)
                }
            }
        } else {
            isWaitingForPiPTransition = false
            pipHandler.removeCallbacksAndMessages(null)
            restoreFromPiP()
        }
        onPictureInPictureChange(mapOf("isActive" to isInPiP))
        dispatchPictureInPictureState(isInPiP)
    }

    fun cleanup() {
        isWaitingForPiPTransition = false
        pipHandler.removeCallbacksAndMessages(null)
        pipController?.stopPictureInPicture()
        renderer?.stop()
        pendingSurface?.release()
        pendingSurface = null
        surfaceTexture = null
        surfaceReady = false
        renderer = null
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        cleanup()
    }
}

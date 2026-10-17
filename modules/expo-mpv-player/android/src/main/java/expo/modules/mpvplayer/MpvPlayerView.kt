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
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.ViewTreeObserver
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
    MPVLayerRenderer.Delegate, SurfaceHolder.Callback, PiPController.Delegate {

    val onLoad by EventDispatcher()
    val onPlaybackStateChange by EventDispatcher()
    val onProgress by EventDispatcher()
    val onError by EventDispatcher()
    val onTracksReady by EventDispatcher()
    val onPictureInPictureChange by EventDispatcher()

    private var surfaceView: SurfaceView
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
    private var hostForeground: Boolean = true
    private var pipRecoveryPending: Boolean = false

    private var rendererStarted: Boolean = false

    private val pipHandler = Handler(Looper.getMainLooper())
    private val recoverRunnable = Runnable { recoverVideoOutput() }

    // The SurfaceView makes the window keep a transparent-region hint for SurfaceFlinger, but Android only
    // recomputes that hint during a full layout traversal, which Fabric's mounting doesn't trigger. On Android TV
    // (seen on an NVIDIA Shield) the hint went stale, e.g. [0,24,1920,1080], and SurfaceFlinger cropped the app
    // layer to a thin strip, so the player controls and dialogs were mounted but never shown over the video.
    // After a redraw, request one layout pass so the hint is rebuilt; the draw caused by that pass is skipped
    // so this doesn't loop.
    private var transparentRegionRefreshPosted = false
    private var skipNextDrawForRegionRefresh = false
    private val refreshTransparentRegion = Runnable {
        transparentRegionRefreshPosted = false
        skipNextDrawForRegionRefresh = true
        rootView?.requestLayout()
    }
    private val transparentRegionDrawListener = ViewTreeObserver.OnDrawListener {
        if (skipNextDrawForRegionRefresh) {
            skipNextDrawForRegionRefresh = false
        } else if (!transparentRegionRefreshPosted) {
            transparentRegionRefreshPosted = true
            pipHandler.postDelayed(refreshTransparentRegion, 30)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        viewTreeObserver.addOnDrawListener(transparentRegionDrawListener)
    }

    init {
        setBackgroundColor(Color.BLACK)

        surfaceView = SurfaceView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        surfaceView.holder.addCallback(this)
        surfaceView.addOnLayoutChangeListener { _, left, top, right, bottom,
                                                oldLeft, oldTop, oldRight, oldBottom ->
            val width = right - left
            val height = bottom - top
            val oldWidth = oldRight - oldLeft
            val oldHeight = oldBottom - oldTop
            if (width > 0 && height > 0 && (width != oldWidth || height != oldHeight)) {
                renderer?.updateSurfaceSize(width, height)
            }
        }
        addView(surfaceView)

        renderer = MPVLayerRenderer(context).also {
            it.delegate = this
        }

        pipController = PiPController(context, appContext).also {
            it.setPlayerView(surfaceView)
            it.delegate = this
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true

        if (rendererStarted) {
            renderer?.attachSurface(holder.surface)
            syncSurfaceSize()
        }

        applyPendingSourceR()

        if (hostForeground && pipRecoveryPending) {
            scheduleRecovery()
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        if (width > 0 && height > 0) {
            renderer?.updateSurfaceSize(width, height)
        }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        renderer?.detachSurface()
    }

    private fun syncSurfaceSize() {
        if (!surfaceReady) return
        val width = surfaceView.width
        val height = surfaceView.height
        if (width > 0 && height > 0) {
            renderer?.updateSurfaceSize(width, height)
        }
    }

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
            surfaceView.holder.surface?.takeIf { surfaceReady && it.isValid }?.let { surface ->
                renderer?.attachSurface(surface)
                syncSurfaceSize()
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
        val started = pipController?.startPictureInPicture() != null
        dispatchPictureInPictureState(started || isPictureInPictureActive())

        pipHandler.removeCallbacksAndMessages(null)
        pipHandler.postDelayed({ syncSurfaceSize() }, 100)
        pipHandler.postDelayed({ syncSurfaceSize() }, 500)
        return started
    }

    fun stopPictureInPicture() {
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

    fun getPlayerView(): android.view.View = surfaceView

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
        pipHandler.removeCallbacksAndMessages(null)
        pipHandler.postDelayed({ syncSurfaceSize() }, 100)
        if (isInPiP) {
            pipRecoveryPending = false
            pipHandler.postDelayed({ syncSurfaceSize() }, 500)
        } else {
            pipRecoveryPending = true
            if (hostForeground) scheduleRecovery()
        }
        onPictureInPictureChange(mapOf("isActive" to isInPiP))
        dispatchPictureInPictureState(isInPiP)
    }

    fun setHostForeground(foreground: Boolean) {
        hostForeground = foreground
    }

    fun onHostResume() {
        hostForeground = true
        if (!rendererStarted || currentUrl == null) return
        if (isPictureInPictureActive()) return

        if (!pipRecoveryPending && (renderer?.isTv != true || intendedPlayState)) return

        scheduleRecovery()
    }

    private fun scheduleRecovery() {
        pipHandler.removeCallbacks(recoverRunnable)
        pipHandler.postDelayed(recoverRunnable, 300)
    }

    private fun recoverVideoOutput() {
        if (!hostForeground || !rendererStarted || currentUrl == null) return
        if (!surfaceReady || isPictureInPictureActive()) return

        val pipRecovery = pipRecoveryPending
        if (!pipRecovery && (renderer?.isTv != true || intendedPlayState)) return

        val surface = surfaceView.holder.surface.takeIf { it.isValid } ?: return
        val recovered = renderer?.recoverVideoOutput(
            surface = surface,
            playWhenReady = pipRecovery && intendedPlayState,
        ) == true

        if (pipRecovery && recovered) {
            pipRecoveryPending = false
        }
    }

    fun cleanup() {
        pipHandler.removeCallbacksAndMessages(null)
        pipController?.stopPictureInPicture()
        renderer?.stop()
        hostForeground = false
        pipRecoveryPending = false
        surfaceReady = false
        currentUrl = null
        rendererStarted = false
        renderer = null
    }

    override fun onDetachedFromWindow() {
        viewTreeObserver.removeOnDrawListener(transparentRegionDrawListener)
        pipHandler.removeCallbacks(refreshTransparentRegion)
        super.onDetachedFromWindow()
        cleanup()
    }
}

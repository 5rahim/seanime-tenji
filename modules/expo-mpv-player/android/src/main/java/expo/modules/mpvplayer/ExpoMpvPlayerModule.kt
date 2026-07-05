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

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.*

private const val TAG = "ExpoMpvPlayer"

class ExpoMpvPlayerModule : Module() {

    private var hiddenDevMenuBindingView: View? = null
    private var shouldRestoreDevMenuFab = false
    private var isActivityInForeground = true
    private val mainHandler = Handler(Looper.getMainLooper())

    // hold a weak reference to the active view for background/foreground PiP logic
    private var activeView: MpvPlayerView? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoMpvPlayer")

        OnActivityEntersBackground {
            isActivityInForeground = false
            val inPiP = activeView?.isPictureInPictureActive() == true
            if (!inPiP) {
                activeView?.pause()
            }
        }

        OnActivityEntersForeground {
            isActivityInForeground = true
            val activity = appContext.currentActivity
            if (activity != null) {
                restoreExpoDevMenuOverlay(activity)
            }
            activeView?.dispatchPictureInPictureState(activeView?.isPictureInPictureActive() == true)
        }

        // orientation stubs (no-op on Android, use expo-screen-orientation)
        Function("lockLandscape") { }
        Function("unlockOrientation") { }

        Function("setWindowBrightness") { brightness: Double ->
            val activity = appContext.currentActivity ?: return@Function
            activity.runOnUiThread {
                try {
                    val window = activity.window
                    val lp = window.attributes
                    lp.screenBrightness = brightness.toFloat()
                    window.attributes = lp
                    val decorView = window.decorView
                    val controller = androidx.core.view.WindowInsetsControllerCompat(window, decorView)
                    controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
                    controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } catch (e: Exception) {
                    Log.e(TAG, "Error setting window brightness", e)
                }
            }
        }

            View(MpvPlayerView::class) {
            Prop("gpuNext") { view: MpvPlayerView, enabled: Boolean ->
                view.setGpuNext(enabled)
            }

            Prop("source") { view: MpvPlayerView, source: Map<String, Any?>? ->
                if (source == null) return@Prop
                val url = source["url"] as? String ?: return@Prop

                val headers = (source["headers"] as? Map<*, *>)?.mapNotNull { (k, v) ->
                    val key = k as? String ?: return@mapNotNull null
                    val value = v as? String ?: return@mapNotNull null
                    key to value
                }?.toMap()

                val externalSubtitles = (source["externalSubtitles"] as? List<*>)?.mapNotNull { item ->
                    val map = item as? Map<*, *> ?: return@mapNotNull null
                    val subUrl = map["url"] as? String ?: return@mapNotNull null
                    val title = map["title"] as? String
                    Pair(subUrl, title)
                }

                val startPosition = (source["startPosition"] as? Number)?.toDouble()
                val autoplay = (source["autoplay"] as? Boolean) ?: true

                val config = VideoLoadConfig(
                    url = url,
                    headers = headers,
                    externalSubtitles = externalSubtitles,
                    startPosition = startPosition,
                    autoplay = autoplay
                )
                view.loadVideo(config)
            }

            OnViewDidUpdateProps { view ->
                activeView = view
            }

            // playback
            AsyncFunction("play") { view: MpvPlayerView -> view.play() }
            AsyncFunction("pause") { view: MpvPlayerView -> view.pause() }
            AsyncFunction("seekTo") { view: MpvPlayerView, position: Double -> view.seekTo(position) }
            AsyncFunction("seekBy") { view: MpvPlayerView, offset: Double -> view.seekBy(offset) }
            AsyncFunction("setSpeed") { view: MpvPlayerView, speed: Double -> view.setSpeed(speed) }
            AsyncFunction("getSpeed") { view: MpvPlayerView -> view.getSpeed() }
            AsyncFunction("isPaused") { view: MpvPlayerView -> view.isPaused() }
            AsyncFunction("getCurrentPosition") { view: MpvPlayerView -> view.getCurrentPosition() }
            AsyncFunction("getDuration") { view: MpvPlayerView -> view.getDuration() }

            // PiP
            AsyncFunction("startPictureInPicture") { view: MpvPlayerView ->
                val activity = appContext.currentActivity
                if (activity != null) {
                    activity.runOnUiThread {
                        hideExpoDevMenuOverlay(activity)
                        view.startPictureInPicture()
                    }
                }
            }
            AsyncFunction("stopPictureInPicture") { view: MpvPlayerView -> view.stopPictureInPicture() }
            AsyncFunction("isPictureInPictureSupported") { view: MpvPlayerView -> view.isPictureInPictureSupported() }
            AsyncFunction("isPictureInPictureActive") { view: MpvPlayerView -> view.isPictureInPictureActive() }

            // subtitle controls
            AsyncFunction("getSubtitleTracks") { view: MpvPlayerView -> view.getSubtitleTracks() }
            AsyncFunction("getChapters") { view: MpvPlayerView -> view.getChapters() }
            AsyncFunction("setSubtitleTrack") { view: MpvPlayerView, trackId: Int -> view.setSubtitleTrack(trackId) }
            AsyncFunction("disableSubtitles") { view: MpvPlayerView -> view.disableSubtitles() }
            AsyncFunction("getCurrentSubtitleTrack") { view: MpvPlayerView -> view.getCurrentSubtitleTrack() }
            AsyncFunction("addSubtitleFile") { view: MpvPlayerView, url: String, select: Boolean -> view.addSubtitleFile(url, select) }
            AsyncFunction("setSubtitleDelay") { view: MpvPlayerView, delay: Double -> view.setSubtitleDelay(delay) }
            AsyncFunction("setSubtitleFontSize") { view: MpvPlayerView, size: Int -> view.setSubtitleFontSize(size) }
            AsyncFunction("setSubtitleVisibility") { view: MpvPlayerView, visible: Boolean -> view.setSubtitleVisibility(visible) }
            AsyncFunction("setSubtitlePosition") { view: MpvPlayerView, position: Int -> view.setSubtitlePosition(position) }

            // audio controls
            AsyncFunction("getAudioTracks") { view: MpvPlayerView -> view.getAudioTracks() }
            AsyncFunction("setAudioTrack") { view: MpvPlayerView, trackId: Int -> view.setAudioTrack(trackId) }
            AsyncFunction("getCurrentAudioTrack") { view: MpvPlayerView -> view.getCurrentAudioTrack() }
            AsyncFunction("setAudioDelay") { view: MpvPlayerView, delay: Double -> view.setAudioDelay(delay) }

            // zoom
            AsyncFunction("setVideoZoom") { view: MpvPlayerView, scale: Double -> view.setVideoZoom(scale) }
            AsyncFunction("setZoomedToFill") { view: MpvPlayerView, zoomed: Boolean -> view.setZoomedToFill(zoomed) }
            AsyncFunction("isZoomedToFill") { view: MpvPlayerView -> view.isZoomedToFill() }

            // technical info
            AsyncFunction("getTechnicalInfo") { view: MpvPlayerView -> view.getTechnicalInfo() }

            // events
            Events("onLoad", "onPlaybackStateChange", "onProgress", "onError", "onTracksReady", "onPictureInPictureChange")
        }
    }

    // -------------------------------------------------------------------
    // Expo dev menu FAB workaround (dev builds only)
    // -------------------------------------------------------------------

    private fun hideExpoDevMenuOverlay(activity: Activity) {
        try {
            val prefs = activity.applicationContext.getSharedPreferences(
                "expo.modules.devmenu.sharedpreferences",
                Context.MODE_PRIVATE,
            )
            shouldRestoreDevMenuFab = prefs.getBoolean("showFab", false)
            if (shouldRestoreDevMenuFab) {
                prefs.edit().putBoolean("showFab", false).commit()
            }
        } catch (e: Exception) {
            Log.d(TAG, "Expo dev menu preferences unavailable", e)
        }

        val bindingView = findViewByClassName(
            activity.window?.decorView,
            "expo.modules.devmenu.compose.BindingView",
        )
        hiddenDevMenuBindingView = bindingView
        bindingView?.visibility = View.GONE
    }

    private fun restoreExpoDevMenuOverlay(activity: Activity) {
        hiddenDevMenuBindingView?.visibility = View.VISIBLE
        hiddenDevMenuBindingView = null

        if (!shouldRestoreDevMenuFab) return
        shouldRestoreDevMenuFab = false
        try {
            activity.applicationContext
                .getSharedPreferences("expo.modules.devmenu.sharedpreferences", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("showFab", true)
                .commit()
        } catch (e: Exception) {
            Log.d(TAG, "Failed to restore Expo dev menu FAB", e)
        }
    }

    private fun findViewByClassName(view: View?, className: String): View? {
        if (view == null) return null
        if (view.javaClass.name == className) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                val found = findViewByClassName(view.getChildAt(index), className)
                if (found != null) return found
            }
        }
        return null
    }
}

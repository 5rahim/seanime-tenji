import type { PlayerPreferences } from "@/lib/player/player-preferences"
import React from "react"

export type PlayerPanel =
    | "main"
    | "episodes"
    | "audio-subtitles"
    | "speed"
    | "seek-buttons"
    | "double-tap-seek"
    | "video-sources"
    | "video-output"
    | "subtitle-delay"
    | "audio-delay"
    | "subtitle-size"
    | "audio-tracks"
    | "subtitle-tracks"
    | "external-subtitles"
    | "default-audio-lang"
    | "default-subtitle-lang"

export type SideAdjustKind = "brightness" | "volume"

export type GestureRefs = {
    controlsVisible: boolean
    controlsLocked: boolean
    panel: PlayerPanel | null
    isPiPActive: boolean
    paused: boolean
    currentTime: number
    duration: number
    speed: number
    centerTapPlayPause: boolean
    doubleTapSeekSec: number
    longPressFastForwardSpeed: number
    sideSwipeBrightnessVolume: boolean
}

export function createGestureRefs(): GestureRefs {
    return {
        controlsVisible: true,
        controlsLocked: false,
        panel: null,
        isPiPActive: false,
        paused: false,
        currentTime: 0,
        duration: 0,
        speed: 1,
        centerTapPlayPause: false,
        doubleTapSeekSec: 10,
        longPressFastForwardSpeed: 2,
        sideSwipeBrightnessVolume: true,
    }
}

/**
 * Sync gRef with the latest render values. Call this at the top of the
 * component body so gesture handlers always read fresh state.
 */
export function syncGestureRef(
    gRef: React.RefObject<GestureRefs>,
    values: {
        controlsVisible: boolean
        controlsLocked: boolean
        panel: PlayerPanel | null
        isPiPActive: boolean
        paused: boolean
        currentTime: number
        duration: number
        speed: number
        prefs: Pick<PlayerPreferences, "centerTapPlayPause" | "doubleTapSeekSec" | "longPressFastForwardSpeed" | "sideSwipeBrightnessVolume">
    },
) {
    gRef.current = {
        controlsVisible: values.controlsVisible,
        controlsLocked: values.controlsLocked,
        panel: values.panel,
        isPiPActive: values.isPiPActive,
        paused: values.paused,
        currentTime: values.currentTime,
        duration: values.duration,
        speed: values.speed,
        centerTapPlayPause: values.prefs.centerTapPlayPause,
        doubleTapSeekSec: values.prefs.doubleTapSeekSec,
        longPressFastForwardSpeed: values.prefs.longPressFastForwardSpeed,
        sideSwipeBrightnessVolume: values.prefs.sideSwipeBrightnessVolume,
    }
}

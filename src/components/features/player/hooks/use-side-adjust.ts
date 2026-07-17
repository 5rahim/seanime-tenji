import * as Brightness from "expo-brightness"
import { MpvPlayerModule } from "expo-mpv-player"
import * as NavigationBar from "expo-navigation-bar"
import React from "react"
import { Platform } from "react-native"
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated"
import { VolumeManager } from "react-native-volume-manager"
import { SIDE_ADJUST_FEEDBACK_HIDE_DELAY } from "../constants"
import { clamp } from "../helpers"
import type { SideAdjustKind } from "../types"

const ANDROID_BRIGHTNESS_WRITE_INTERVAL_MS = 80

export function useSideAdjust(
    // savedLevel: number | null,
    // saveLevel: (value: number) => void,
) {
    // const savedLevelRef = React.useRef(savedLevel)
    // const saveLevelRef = React.useRef(saveLevel)
    // saveLevelRef.current = saveLevel
    const brightnessLevelRef = React.useRef(0.5)
    const didSyncBrightnessRef = React.useRef(false)
    const initialBrightnessRef = React.useRef(0.5)
    const hasInitialBrightnessRef = React.useRef(false)
    const initialUsesSystemBrightnessRef = React.useRef<boolean | null>(null)
    const didOverrideBrightnessRef = React.useRef(false)
    const volumeLevelRef = React.useRef(0.5)
    const sideAdjustKindRef = React.useRef<SideAdjustKind | null>(null)
    const sideAdjustStartYRef = React.useRef(0)
    const sideAdjustStartValueRef = React.useRef(0.5)
    const sideAdjustActivatedRef = React.useRef(false)
    const sideAdjustHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const brightnessWriteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingBrightnessValueRef = React.useRef<number | null>(null)
    const lastBrightnessWriteAtRef = React.useRef(0)
    // const lastSavedLevelRef = React.useRef(savedLevel)
    const pendingSideAdjustRef = React.useRef<{ kind: SideAdjustKind; value: number } | null>(null)
    const sideAdjustFrameRef = React.useRef<number | null>(null)
    const sideAdjustProgress = useSharedValue(0.5)
    const [sideAdjustFeedbackKind, setSideAdjustFeedbackKind] = React.useState<SideAdjustKind | null>(null)

    const sideAdjustFillStyle = useAnimatedStyle(() => ({
        height: Math.max(8, 92 * sideAdjustProgress.value),
    }))

    React.useEffect(() => {
        let mounted = true

        const sync = async () => {
            try {
                const brightness = await Brightness.getBrightnessAsync()
                if (mounted) {
                    let level = brightness

                    // if (savedLevelRef.current !== null) {
                    //     level = clamp(savedLevelRef.current, 0, 1)
                    //     didOverrideBrightnessRef.current = true
                    //     if (Platform.OS === "android") {
                    //         MpvPlayerModule.setWindowBrightness(level)
                    //     } else {
                    //         void Brightness.setBrightnessAsync(level).catch(() => undefined)
                    //     }
                    // }

                    brightnessLevelRef.current = level
                    didSyncBrightnessRef.current = true
                    if (!hasInitialBrightnessRef.current && !didOverrideBrightnessRef.current) {
                        initialBrightnessRef.current = brightness
                        hasInitialBrightnessRef.current = true
                    }
                    sideAdjustProgress.set(level)
                }
            }
            catch {
            }

            if (Platform.OS === "android" && initialUsesSystemBrightnessRef.current === null) {
                try {
                    const isUsingSystemBrightness = await Brightness.isUsingSystemBrightnessAsync()
                    if (mounted) {
                        initialUsesSystemBrightnessRef.current = isUsingSystemBrightness
                    }
                }
                catch {
                }
            }

            try {
                const result = await VolumeManager.getVolume()
                if (mounted) volumeLevelRef.current = result.volume
            }
            catch {
            }
        }

        void sync()

        const volumeListener = VolumeManager.addVolumeListener((result) => {
            volumeLevelRef.current = result.volume
        })

        return () => {
            mounted = false
            volumeListener.remove()
        }
    }, [sideAdjustProgress])

    const flushPendingBrightness = React.useCallback(() => {
        if (brightnessWriteTimerRef.current !== null) {
            clearTimeout(brightnessWriteTimerRef.current)
            brightnessWriteTimerRef.current = null
        }

        const nextValue = pendingBrightnessValueRef.current
        pendingBrightnessValueRef.current = null
        if (nextValue === null) return

        lastBrightnessWriteAtRef.current = Date.now()
        if (Platform.OS === "android") {
            MpvPlayerModule.setWindowBrightness(nextValue)
        } else {
            void Brightness.setBrightnessAsync(nextValue).catch(() => undefined)
        }
    }, [])

    const queueBrightnessWrite = React.useCallback((value: number) => {
        pendingBrightnessValueRef.current = value

        if (Platform.OS !== "android") {
            flushPendingBrightness()
            return
        }

        const elapsed = Date.now() - lastBrightnessWriteAtRef.current
        if (elapsed >= ANDROID_BRIGHTNESS_WRITE_INTERVAL_MS) {
            flushPendingBrightness()
            return
        }

        if (brightnessWriteTimerRef.current !== null) return

        brightnessWriteTimerRef.current = setTimeout(
            flushPendingBrightness,
            ANDROID_BRIGHTNESS_WRITE_INTERVAL_MS - elapsed,
        )
    }, [flushPendingBrightness])

    // cleanup
    React.useEffect(() => {
        return () => {
            if (sideAdjustFrameRef.current !== null) cancelAnimationFrame(sideAdjustFrameRef.current)
            if (sideAdjustHideTimerRef.current) clearTimeout(sideAdjustHideTimerRef.current)
            // flushPendingBrightness()
            if (brightnessWriteTimerRef.current !== null) clearTimeout(brightnessWriteTimerRef.current)
            pendingBrightnessValueRef.current = null

            if (!didOverrideBrightnessRef.current) return

            // const level = brightnessLevelRef.current
            // if (lastSavedLevelRef.current !== level) {
            //     lastSavedLevelRef.current = level
            //     saveLevelRef.current(level)
            // }

            // Android brightness gestures use an activity override, so restore the
            // previous app/system behavior when the player closes.
            if (Platform.OS === "android" && initialUsesSystemBrightnessRef.current !== false) {
                void Brightness.restoreSystemBrightnessAsync().catch(() => undefined)
                return
            }

            if (hasInitialBrightnessRef.current) {
                void Brightness.setBrightnessAsync(initialBrightnessRef.current).catch(() => undefined)
            }
        }
    }, [])

    const clearSideAdjustHideTimer = React.useCallback(() => {
        if (sideAdjustHideTimerRef.current) {
            clearTimeout(sideAdjustHideTimerRef.current)
            sideAdjustHideTimerRef.current = null
        }
    }, [])

    const scheduleSideAdjustHide = React.useCallback(() => {
        clearSideAdjustHideTimer()
        flushPendingBrightness()

        // const level = brightnessLevelRef.current
        // if (didOverrideBrightnessRef.current && lastSavedLevelRef.current !== level) {
        //     lastSavedLevelRef.current = level
        //     saveLevelRef.current(level)
        // }

        if (Platform.OS === "android") {
            setTimeout(() => {
                void NavigationBar.setVisibilityAsync("hidden").catch(() => undefined)
            }, 100)
        }

        sideAdjustHideTimerRef.current = setTimeout(() => {
            setSideAdjustFeedbackKind(null)
            sideAdjustHideTimerRef.current = null
        }, SIDE_ADJUST_FEEDBACK_HIDE_DELAY)
    }, [clearSideAdjustHideTimer, flushPendingBrightness])

    const applySideAdjustment = React.useCallback((kind: SideAdjustKind, value: number) => {
        const nextValue = clamp(value, 0, 1)
        sideAdjustProgress.set(nextValue)
        setSideAdjustFeedbackKind(current => current === kind ? current : kind)

        if (kind === "brightness") {
            if (!hasInitialBrightnessRef.current && didSyncBrightnessRef.current) {
                initialBrightnessRef.current = brightnessLevelRef.current
                hasInitialBrightnessRef.current = true
            }
            didOverrideBrightnessRef.current = true
            brightnessLevelRef.current = nextValue
            queueBrightnessWrite(nextValue)
        } else {
            volumeLevelRef.current = nextValue
            void VolumeManager.setVolume(nextValue, { showUI: false }).catch(() => undefined)
        }
    }, [queueBrightnessWrite, sideAdjustProgress])

    const scheduleSideAdjustUpdate = React.useCallback((kind: SideAdjustKind, value: number) => {
        pendingSideAdjustRef.current = { kind, value: clamp(value, 0, 1) }
        clearSideAdjustHideTimer()

        if (sideAdjustFrameRef.current !== null) return

        sideAdjustFrameRef.current = requestAnimationFrame(() => {
            sideAdjustFrameRef.current = null
            const pending = pendingSideAdjustRef.current
            if (!pending) return
            applySideAdjustment(pending.kind, pending.value)
        })
    }, [applySideAdjustment, clearSideAdjustHideTimer])

    return {
        brightnessLevelRef,
        volumeLevelRef,
        sideAdjustKindRef,
        sideAdjustStartYRef,
        sideAdjustStartValueRef,
        sideAdjustActivatedRef,
        sideAdjustFeedbackKind,
        sideAdjustFillStyle,
        sideAdjustProgress,
        scheduleSideAdjustHide,
        scheduleSideAdjustUpdate,
    }
}

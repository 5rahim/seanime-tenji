import type { PlayerChapter } from "@/lib/player"
import type { TechnicalInfo } from "expo-mpv-player"
import FastForward from "lucide-react-native/icons/fast-forward"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import Sun from "lucide-react-native/icons/sun"
import Volume2 from "lucide-react-native/icons/volume-2"
import React from "react"
import { Platform, StyleSheet, Text, View, type ViewStyle } from "react-native"
import Animated, { type AnimatedStyle, FadeIn, FadeOut, Keyframe, runOnJS, type SharedValue, useAnimatedReaction } from "react-native-reanimated"
import { QUIET_HUD_TEXT } from "./constants"
import { formatTime } from "./helpers"

///////////////////////////////////////////////////////////////////////////////
// Playback stats
///////////////////////////////////////////////////////////////////////////////

function fixed(value?: number, digits = 2) {
    return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits)
}

function bitrate(value?: number) {
    if (value == null || !Number.isFinite(value) || value <= 0) return "—"
    return `${(value / 1_000_000).toFixed(2)} Mbps`
}

function decoder(value?: string) {
    if (!value?.trim() || value === "no") return "software"
    return value
}

export function PlayerStatsOverlay({
    info,
    top,
    right,
}: {
    info: TechnicalInfo | null
    top: number
    right: number
}) {
    const size = Platform.isTV ? 16 : 11
    const lineHeight = Platform.isTV ? 22 : 15

    if (!info) {
        return (
            <View pointerEvents="none" style={[styles.stats, { top, right }]}>
                <Text style={[styles.statsTitle, { fontSize: size, lineHeight }]}>PLAYBACK STATS</Text>
                <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Reading player…</Text>
            </View>
        )
    }

    const resolution = info.videoWidth && info.videoHeight
        ? `${info.videoWidth}×${info.videoHeight}`
        : "—"
    const dropped = `${info.droppedFrames ?? 0} render / ${info.decoderDroppedFrames ?? 0} decode`
    const cache = `${fixed(info.cacheSeconds, 1)} / ${fixed(info.cacheLimit, 0)} s`
    const cap = info.maxCacheMiB == null
        ? "—"
        : `${info.maxCacheMiB} MiB / ${info.backCacheMiB ?? 0} MiB back`

    return (
        <View pointerEvents="none" style={[styles.stats, { top, right }]}>
            <Text style={[styles.statsTitle, { fontSize: size, lineHeight }]}>PLAYBACK STATS</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Video      {info.videoCodec ?? "—"} · {resolution} · {fixed(info.fps)} fps</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Decoder    {decoder(info.hwdec)}{info.hwPixelFormat ? ` · ${info.hwPixelFormat}` : ""}</Text>
            {info.requestedHwdec ? (
                <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Requested  {info.requestedHwdec} · option {info.hwdecOptionResult ?? "—"}</Text>
            ) : null}
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Output     {info.voDriver ?? "—"} · display {fixed(info.displayFps)} Hz</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Audio      {info.audioCodec ?? "—"} · video {bitrate(info.videoBitrate)}</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Dropped    {dropped}</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Buffer     {info.isBuffering ? "yes" : "no"} · cache {cache}</Text>
            <Text style={[styles.statsText, { fontSize: size, lineHeight }]}>Cache cap  {cap}</Text>
            {info.decoderError ? (
                <Text style={[styles.statsError, { fontSize: size, lineHeight }]}>Error      {info.decoderError}</Text>
            ) : null}
        </View>
    )
}

const styles = StyleSheet.create({
    stats: {
        position: "absolute",
        zIndex: 45,
        minWidth: 270,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.22)",
        backgroundColor: "rgba(0,0,0,0.78)",
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    statsTitle: {
        color: "rgba(255,255,255,0.7)",
        fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
        fontWeight: "700",
        marginBottom: 3,
    },
    statsText: {
        color: "rgba(255,255,255,0.92)",
        fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
        fontVariant: ["tabular-nums"],
    },
    statsError: {
        color: "#fca5a5",
        fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
        marginTop: 3,
        maxWidth: 620,
    },
})

///////////////////////////////////////////////////////////////////////////////
// Fast-forward badge (long-press)
///////////////////////////////////////////////////////////////////////////////

export function FastForwardBadge({ speed }: { speed: number }) {
    return (
        <Animated.View
            entering={FadeIn.duration(100)}
            exiting={FadeOut.duration(100)}
            className="absolute left-0 right-0 top-4 items-center"
            pointerEvents="none"
        >
            <View className="flex-row items-center gap-1.5 rounded-full bg-black/75 px-4 py-2">
                <FastForward size={16} color="#fff" />
                <Text className="text-sm font-bold text-white">
                    {speed}x
                </Text>
            </View>
        </Animated.View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Swipe-to-seek overlay
///////////////////////////////////////////////////////////////////////////////

export function SwipeSeekOverlay({
    swipeSeeking,
    duration,
    seekingChapter,
}: {
    swipeSeeking: { startTime: number; currentTime: number }
    duration: number
    seekingChapter?: PlayerChapter
}) {
    return (
        <Animated.View
            entering={FadeIn.duration(80)}
            exiting={FadeOut.duration(80)}
            className="absolute left-0 right-0 top-4 items-center justify-center"
            pointerEvents="none"
        >
            <View className="items-center gap-1 rounded-xl bg-black/50 px-4 py-2.5">
                <View className="flex-row items-center gap-1.5">
                    <Text className="text-lg font-bold text-white" style={{ fontVariant: ["tabular-nums"] }}>
                        {formatTime(swipeSeeking.currentTime)}
                    </Text>
                    <Text className="text-base font-bold text-white/50" style={{ fontVariant: ["tabular-nums"] }}>
                        / {formatTime(duration)}
                    </Text>
                </View>
                <Text className="text-sm text-white/50" style={{ fontVariant: ["tabular-nums"] }}>
                    {swipeSeeking.currentTime >= swipeSeeking.startTime ? "+" : ""}
                    {formatTime(Math.abs(swipeSeeking.currentTime - swipeSeeking.startTime))}
                </Text>
                {seekingChapter?.title && (
                    <Text className="mt-0.5 text-xs text-white/40" numberOfLines={1}>
                        {seekingChapter.title}
                    </Text>
                )}
            </View>
        </Animated.View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Double-tap seek flash
///////////////////////////////////////////////////////////////////////////////

export function DoubleTapFlash({
    side,
    amount,
    screenWidth,
    animatedStyle,
}: {
    side: "left" | "right"
    amount: number
    screenWidth: number
    animatedStyle: AnimatedStyle<ViewStyle>
}) {
    return (
        <Animated.View
            style={[{
                position: "absolute", top: 0, bottom: 0,
                width: screenWidth / 2,
                left: side === "left" ? 0 : screenWidth / 2,
                alignItems: "center", justifyContent: "center",
            }, animatedStyle]}
            pointerEvents="none"
        >
            <View className="items-center justify-center bg-white/12" style={{ width: 78, height: 78, borderRadius: 39 }}>
                {side === "left"
                    ? <RotateCcw size={26} color="#fff" />
                    : <RotateCw size={26} color="#fff" />}
                <Text className="mt-0.5 text-xs font-semibold text-white">
                    {side === "left" ? "-" : "+"}{amount}s
                </Text>
            </View>
        </Animated.View>
    )
}

const containerKeyframeIn = new Keyframe({
    0: {
        transform: [{ scale: 0.85 }],
        opacity: 0,
    },
    100: {
        transform: [{ scale: 1 }],
        opacity: 1,
    },
}).duration(100)

const containerKeyframeOut = new Keyframe({
    0: {
        transform: [{ scale: 1 }],
        opacity: 1,
    },
    100: {
        transform: [{ scale: 1.1 }],
        opacity: 0,
    },
}).duration(90)

export function CenterTapFeedback({ feedback }: { feedback: "play" | "pause" }) {
    return (
        <Animated.View
            entering={containerKeyframeIn}
            exiting={containerKeyframeOut}
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center"
            style={{ zIndex: 999 }}
        >
            <View className="size-16 items-center justify-center rounded-full bg-black/60">
                {feedback === "pause" ? (
                    <Pause size={32} color="#ffffff" fill="#ffffff" />
                ) : (
                    <Play size={32} color="#ffffff" fill="#ffffff" style={{ marginLeft: 4 }} />
                )}
            </View>
        </Animated.View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Side-adjust (brightness / volume) HUD
///////////////////////////////////////////////////////////////////////////////

export function SideAdjustHUD({
    kind,
    progress,
    initialProgress,
    insets,
    screenHeight,
    padL,
    padR,
    sideAdjustFillStyle,
}: {
    kind: "brightness" | "volume"
    progress: SharedValue<number>
    initialProgress: number
    insets: { top: number }
    screenHeight: number
    padL: number
    padR: number
    sideAdjustFillStyle: AnimatedStyle<ViewStyle>
}) {
    const [displayPercent, setDisplayPercent] = React.useState(Math.round(initialProgress * 100))

    const updateDisplayPercent = React.useCallback((value: number) => {
        setDisplayPercent(current => current === value ? current : value)
    }, [])

    React.useEffect(() => {
        setDisplayPercent(Math.round(initialProgress * 100))
    }, [kind, initialProgress])

    useAnimatedReaction(() => {
        "worklet"
        const isWorklet = (globalThis as typeof globalThis & { _WORKLET?: boolean })._WORKLET
        return isWorklet ? Math.round(progress.value * 100) : 0
    }, (nextValue, previousValue) => {
        "worklet"
        if (nextValue !== previousValue) {
            runOnJS(updateDisplayPercent)(nextValue)
        }
    }, [progress, updateDisplayPercent])

    return (
        <Animated.View
            entering={FadeIn.duration(100)}
            exiting={FadeOut.duration(160)}
            pointerEvents="none"
            style={{
                position: "absolute",
                top: Math.max(insets.top + 24, (screenHeight / 2) - 110),
                left: kind === "brightness" ? padL : undefined,
                right: kind === "volume" ? padR : undefined,
            }}
        >
            <View className="items-center gap-2 rounded-3xl bg-black/60 px-3 pt-3 pb-3" style={{ width: 68 }}>
                <View className="items-center justify-center rounded-full bg-white/10" style={{ width: 36, height: 36 }}>
                    {kind === "brightness"
                        ? <Sun size={16} color="#fff" />
                        : <Volume2 size={16} color="#fff" />}
                </View>
                <View className="justify-end overflow-hidden rounded-full bg-white/5" style={{ width: 12, height: 84 }}>
                    <Animated.View
                        style={[{
                            width: "100%", borderRadius: 999,
                            backgroundColor: "#fff",
                        }, sideAdjustFillStyle]}
                    />
                </View>
                <Text className="text-sm font-semibold" style={{ color: QUIET_HUD_TEXT, fontVariant: ["tabular-nums"] }}>
                    {displayPercent}%
                </Text>
            </View>
        </Animated.View>
    )
}

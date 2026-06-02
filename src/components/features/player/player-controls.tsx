import type { PlayerChapter, PlayerState as PlayerStateType } from "@/lib/player"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { cn } from "@/lib/utils"
import { ChevronLeft, List, Pause, Play, Settings, SkipForward, Unlock } from "lucide-react-native"
import React from "react"
import { Platform, Text, View, type ViewStyle } from "react-native"
import { GestureDetector, Pressable } from "react-native-gesture-handler"
import type { ComposedGesture, GestureType } from "react-native-gesture-handler"
import Animated, { type AnimatedStyle, FadeIn, FadeOut, type SharedValue, useAnimatedStyle } from "react-native-reanimated"
import { formatTime } from "./helpers"
import type { PlayerPanel } from "./types"

export function Pill({ text, color }: { text: string; color?: string }) {
    return (
        <View className="rounded-md bg-white/10 px-2 py-1">
            <Text className="text-xs font-semibold text-white" style={color ? { color } : undefined}>{text}</Text>
        </View>
    )
}

export function PlayerIconButton({ icon, onPress, active, disabled }: {
    icon: React.ReactNode
    onPress: () => void
    active?: boolean
    disabled?: boolean
}) {
    return (
        <Pressable onPress={disabled ? undefined : onPress} hitSlop={8}>
            {({ pressed }) => (
                <View
                    className={cn(
                        "h-9 w-9 items-center justify-center rounded-full",
                        disabled ? "opacity-30" : "opacity-100",
                        active ? "bg-white/15" : pressed ? "bg-white/10" : "bg-white/5",
                    )}
                >
                    {icon}
                </View>
            )}
        </Pressable>
    )
}

function SegmentFill({
    seekBarProgress,
    startProgress,
    endProgress,
}: {
    seekBarProgress: SharedValue<number>
    startProgress: number
    endProgress: number
}) {
    const animatedStyle = useAnimatedStyle(() => {
        const p = seekBarProgress.value
        const ratio = (p - startProgress) / Math.max(0.0001, endProgress - startProgress)
        const clamped = Math.min(1, Math.max(0, ratio))
        return {
            width: `${clamped * 100}%`,
        }
    })

    return (
        <Animated.View
            style={[
                {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    backgroundColor: "#ffffff",
                    borderRadius: 999,
                },
                animatedStyle,
            ]}
        />
    )
}

interface ControlsOverlayProps {
    source: MobilePlaybackSource | null
    state: PlayerStateType
    insets: { top: number; bottom: number; left: number; right: number }
    zoomMode: "fit" | "fill"
    panel: PlayerPanel | null
    seekBarGesture: GestureType | ComposedGesture
    onSeekBarLayout: (e: { nativeEvent: { layout: { width: number } } }) => void
    seekBarTrackStyle: AnimatedStyle<ViewStyle>
    seekBarFillStyle: AnimatedStyle<ViewStyle>
    seekBarThumbStyle: AnimatedStyle<ViewStyle>
    seekBarGlowStyle: AnimatedStyle<ViewStyle>
    chapterMarkers: Array<{ key: string; left: number; progress: number }>
    progressRatio: number
    displayTime: number
    isSeeking: boolean
    seekingChapter?: PlayerChapter
    onBack: () => void
    onTogglePlayPause: () => void
    scheduleHide: () => void
    clearHideTimer: () => void
    setPanel: React.Dispatch<React.SetStateAction<PlayerPanel | null>>
    canPlayNext: boolean
    onManualNextEpisode: () => void
    chapters: PlayerChapter[]
    seekBarProgress: SharedValue<number>
    onLockScreen: () => void
    onSeekRelative: (delta: number) => void
    buttonSeekSec: number
}

function isSkippableChapter(title?: string) {
    if (!title) return false
    const normalized = title.trim().toLowerCase()
    return /opening$|^opening\s|^op$|ending$|^ending\s|^ed$|^credits/i.test(normalized)
}

export function ControlsOverlay(props: ControlsOverlayProps) {
    const {
        source, state, insets, zoomMode, panel,
        seekBarGesture, onSeekBarLayout,
        seekBarTrackStyle, seekBarFillStyle, seekBarThumbStyle, seekBarGlowStyle,
        chapterMarkers, progressRatio,
        displayTime, isSeeking, seekingChapter,
        onBack, onTogglePlayPause, scheduleHide, clearHideTimer, setPanel,
        canPlayNext, onManualNextEpisode,
        chapters, seekBarProgress,
        onLockScreen, onSeekRelative, buttonSeekSec,
    } = props

    const extendHudPastHorizontalSafeArea = Platform.OS === "ios" && zoomMode === "fill"
    const padL = extendHudPastHorizontalSafeArea ? 24 : insets.left + 16
    const padR = extendHudPastHorizontalSafeArea ? 24 : insets.right + 16
    const topPadL = extendHudPastHorizontalSafeArea ? 12 : insets.left + 12
    const topPadR = extendHudPastHorizontalSafeArea ? 12 : insets.right + 12

    const segments = React.useMemo(() => {
        const duration = state.duration || 1
        if (!chapters || chapters.length === 0) {
            return [{
                id: 0,
                title: undefined as string | undefined,
                start: 0,
                end: duration,
                duration: duration,
                startProgress: 0,
                endProgress: 1,
            }]
        }

        const sorted = [...chapters].sort((a, b) => a.start - b.start)
        const list = []

        for (let i = 0; i < sorted.length; i++) {
            const start = i === 0 ? 0 : sorted[i].start
            const nextStart = i < sorted.length - 1 ? sorted[i + 1].start : duration
            const end = Math.max(start, nextStart)
            const segDuration = Math.max(0.1, end - start)
            list.push({
                id: sorted[i].id,
                title: sorted[i].title,
                start,
                end,
                duration: segDuration,
                startProgress: Math.max(0, Math.min(1, start / duration)),
                endProgress: Math.max(0, Math.min(1, end / duration)),
            })
        }
        return list
    }, [chapters, state.duration])

    return (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} pointerEvents="box-none" className="absolute inset-0">
            <View pointerEvents="none" className="absolute inset-0 bg-black/45" />

            <View pointerEvents="box-none" className="absolute left-0 right-0 top-0">
                <View className="flex-row items-center pb-2" style={{ paddingTop: insets.top + 4, paddingLeft: topPadL, paddingRight: topPadR }}>
                    <Pressable onPress={onBack} hitSlop={12} className="p-2">
                        <ChevronLeft size={28} color="#fff" />
                    </Pressable>

                    <View className="min-w-0 flex-1 shrink pl-3">
                        <Text className="text-base font-bold text-white" numberOfLines={1}>
                            {source?.media?.title?.userPreferred ?? source?.media?.title?.english ?? ""}
                        </Text>
                        {source?.episode && (
                            <Text className="mt-0.5 text-sm text-white/70" numberOfLines={1}>
                                {source.episode.displayTitle +
                                    (source.episode.episodeTitle ? " \u2014 " + source.episode.episodeTitle : "")}
                            </Text>
                        )}
                    </View>

                    <View className="mr-2 flex-row items-center gap-1.5">
                        {state.speed !== 1.0 && <Pill text={`${state.speed}x`} />}
                        {state.subtitleDelay !== 0 && (
                            <Pill
                                text={`Sub ${state.subtitleDelay > 0 ? "+" : ""}${state.subtitleDelay.toFixed(1)}s`}
                                color="#f59e0b"
                            />
                        )}
                        {state.audioDelay !== 0 && (
                            <Pill
                                text={`Audio ${state.audioDelay > 0 ? "+" : ""}${state.audioDelay.toFixed(1)}s`}
                                color="#a78bfa"
                            />
                        )}
                    </View>

                    <View className="flex-row items-center gap-1">
                        {!panel && (
                            <>
                                {(source?.episodes?.length ?? 0) > 1 && (
                                    <PlayerIconButton
                                        icon={<List size={18} color="rgba(255,255,255,0.8)" />}
                                        onPress={() => {
                                            setPanel("episodes")
                                            clearHideTimer()
                                        }}
                                    />
                                )}
                                <PlayerIconButton
                                    icon={<Settings size={18} color="rgba(255,255,255,0.8)" />}
                                    onPress={() => {
                                        setPanel("main")
                                        clearHideTimer()
                                    }}
                                />
                            </>
                        )}
                    </View>
                </View>
            </View>

            {/* <View pointerEvents="box-none" className="absolute left-4 top-1/2 -mt-4.5 z-10" style={{ left: Math.max(16, insets.left) }}>
             <PlayerIconButton
             icon={<Lock size={18} color="#fff" />}
             onPress={onLockScreen}
             />
             </View> */}

            <View pointerEvents="none" className="flex-1" />

            <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0" style={{ paddingBottom: Math.max(16, insets.bottom) }}>
                <View className="h-3.5 justify-center" style={{ paddingLeft: padL, paddingRight: padR }}>
                    {seekingChapter?.title && isSeeking && (
                        <Text className="text-xs font-semibold text-white/80" numberOfLines={1}>
                            {seekingChapter.title}
                        </Text>
                    )}
                </View>

                <View style={{ paddingLeft: padL, paddingRight: padR }}>
                    <GestureDetector gesture={seekBarGesture}>
                        <View collapsable={false} onLayout={onSeekBarLayout} style={{ height: 36, justifyContent: "center" }}>
                            <Animated.View
                                pointerEvents="none"
                                style={[{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: "50%",
                                    marginTop: -8,
                                    height: 16,
                                    borderRadius: 999,
                                }, seekBarGlowStyle]}
                            />

                            <Animated.View className="w-full flex-row items-center gap-[3px]" style={seekBarTrackStyle}>
                                {segments.map((segment, index) => {
                                    const skippable = isSkippableChapter(segment.title)
                                    return (
                                        <View
                                            key={index}
                                            style={{
                                                flexGrow: segment.duration,
                                                flexShrink: 1,
                                                flexBasis: 0,
                                                height: "100%",
                                                backgroundColor: skippable ? "rgba(147, 197, 253, 0.45)" : "rgba(255,255,255,0.2)",
                                                borderRadius: 999,
                                                overflow: "hidden",
                                            }}
                                        >
                                            <SegmentFill
                                                seekBarProgress={seekBarProgress}
                                                startProgress={segment.startProgress}
                                                endProgress={segment.endProgress}
                                            />
                                        </View>
                                    )
                                })}
                            </Animated.View>

                            <Animated.View
                                style={[
                                    {
                                        position: "absolute",
                                        top: "50%",
                                        marginTop: -6,
                                        width: 12,
                                        height: 12,
                                        borderRadius: 6,
                                        backgroundColor: "#fff",
                                        shadowColor: "#000",
                                        shadowOpacity: 0.4,
                                        shadowRadius: 3,
                                        shadowOffset: { width: 0, height: 1 },
                                    },
                                    seekBarThumbStyle,
                                ]}
                            />
                        </View>
                    </GestureDetector>
                </View>

                <View className="flex-row items-center justify-between gap-3" style={{ paddingLeft: padL, paddingRight: padR }}>
                    <View className="flex-row items-center gap-3">
                        <Pressable
                            onPress={() => {
                                onTogglePlayPause()
                                scheduleHide()
                            }} hitSlop={12}
                        >
                            {({ pressed }) => (
                                <View className={cn("h-10 w-10 items-center justify-center rounded-full", pressed ? "bg-white/15" : "bg-white/10")}>
                                    {state.paused
                                        ? <Play size={24} color="#fff" fill="#fff" />
                                        : <Pause size={24} color="#fff" fill="#fff" />}
                                </View>
                            )}
                        </Pressable>

                        {/* <Pressable
                         onPress={() => {
                         onSeekRelative(-buttonSeekSec)
                         scheduleHide()
                         }} hitSlop={12}
                         >
                         {({ pressed }) => (
                         <View className={cn("h-10 w-10 items-center justify-center rounded-full", pressed ? "bg-white/15" : "bg-white/10")}>
                         <RotateCcw size={18} color="#fff" />
                         </View>
                         )}
                         </Pressable>

                         <Pressable
                         onPress={() => {
                         onSeekRelative(buttonSeekSec)
                         scheduleHide()
                         }} hitSlop={12}
                         >
                         {({ pressed }) => (
                         <View className={cn("h-10 w-10 items-center justify-center rounded-full", pressed ? "bg-white/15" : "bg-white/10")}>
                         <RotateCw size={18} color="#fff" />
                         </View>
                         )}
                         </Pressable> */}

                        <Text className="text-sm font-semibold text-white" style={{ fontVariant: ["tabular-nums"] }}>
                            {formatTime(displayTime)}
                            <Text className="text-white/40"> / {formatTime(state.duration)}</Text>
                        </Text>
                    </View>

                    <Pressable onPress={onManualNextEpisode} disabled={!canPlayNext} hitSlop={12}>
                        {({ pressed }) => (
                            <View
                                className={cn(
                                    "h-10 w-10 items-center justify-center rounded-full",
                                    canPlayNext ? "opacity-100" : "opacity-40",
                                    !canPlayNext ? "bg-white/5" : pressed ? "bg-white/15" : "bg-white/10",
                                )}
                            >
                                <SkipForward size={16} color="#fff" />
                            </View>
                        )}
                    </Pressable>
                </View>
            </View>
        </Animated.View>
    )
}


export function LockModeOverlay({
    insets,
    onUnlock,
}: {
    insets: { bottom: number }
    onUnlock: () => void
}) {
    return (
        <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(150)}
            className="absolute left-0 right-0 items-center"
            style={{ bottom: insets.bottom + 16 }}
        >
            <Pressable onPress={onUnlock}>
                {({ pressed }) => (
                    <View
                        className={cn("flex-row items-center gap-1.5 rounded-full border border-white/15 px-4 py-2.5",
                            pressed ? "bg-white/15" : "bg-black/75")}
                    >
                        <Unlock size={15} color="#fff" />
                        <Text className="text-sm font-medium text-white">Unlock</Text>
                    </View>
                )}
            </Pressable>
        </Animated.View>
    )
}

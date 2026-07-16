import type { Anime_Episode } from "@/api/generated/types"
import { useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { animeEntryPlaybackIntentAtom, createAnimeEntryPlaybackIntent } from "@/atoms/anime-entry.atoms"
import { useServerUrl } from "@/atoms/server.atoms"
import { NEXT_EPISODE_CONFIRM_PROGRESS_THRESHOLD, NEXT_EPISODE_CONFIRM_REMAINING_SECONDS } from "@/components/features/player/constants"
import { clamp, formatTime, getChapterAtTime, getFillZoomScale, getSourceVideoAspectRatio } from "@/components/features/player/helpers"
import { useAutoNextEpisode } from "@/components/features/player/hooks/use-auto-next-episode"
import { useControlsVisibility } from "@/components/features/player/hooks/use-controls-visibility"
import { useDoubleTapSeek } from "@/components/features/player/hooks/use-double-tap-seek"
import { useLandscapeOrientationLock } from "@/components/features/player/hooks/use-landscape-orientation-lock"
import { usePlayerGestures } from "@/components/features/player/hooks/use-player-gestures"
import { useSideAdjust } from "@/components/features/player/hooks/use-side-adjust"
import { useSkipData } from "@/components/features/player/hooks/use-skip-data"
import { useSwipeSeek } from "@/components/features/player/hooks/use-swipe-seek"
import { AutoNextCard, NextEpisodeConfirmCard } from "@/components/features/player/player-auto-next"
import { ControlsOverlay, LockModeOverlay } from "@/components/features/player/player-controls"
import { CenterTapFeedback, DoubleTapFlash, FastForwardBadge, SideAdjustHUD, SwipeSeekOverlay } from "@/components/features/player/player-overlays"
import { PlayerPanelOverlay } from "@/components/features/player/player-panel"
import type { PlayerPanel } from "@/components/features/player/types"
import { createGestureRefs, syncGestureRef } from "@/components/features/player/types"
import { isLocalServer } from "@/lib/downloads"
import { useIsServerConnected } from "@/lib/offline"
import {
    currentPlaybackSourceAtom,
    playerErrorAtom,
    playerLoadingMessageAtom,
    useActivePlaybackSource,
    useCleanupPlaybackSession,
} from "@/lib/player"
import type { PlayerChapter } from "@/lib/player"
import { getLocalEpisodePlaybackSource } from "@/lib/player"
import { usePlayerPreferences } from "@/lib/player/player-preferences"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { useContinuitySync } from "@/lib/player/use-continuity-sync"
import { useMpvPlayer } from "@/lib/player/use-mpv-player"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/utils/toast"
import { useKeepAwake } from "expo-keep-awake"
import { MpvPlayerView } from "expo-mpv-player"
import * as NavigationBar from "expo-navigation-bar"
import { useRouter } from "expo-router"
import { useAtom, useAtomValue } from "jotai/react"
import { SkipForward } from "lucide-react-native"
import React from "react"
import { ActivityIndicator, Dimensions, Platform, StatusBar, Text, useWindowDimensions, View } from "react-native"
import { Gesture, GestureDetector, GestureHandlerRootView, Pressable } from "react-native-gesture-handler"
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

///////////////////////////////////////////////////////////////////////////////

type NextEpisodePrompt = {
    title: string
    description: string
    confirmLabel: string
}

const DEFAULT_TEXT_SUBTITLE_MARGIN_Y = 34
const SEEK_SNAP_MAX_THRESHOLD = 4
const SEEK_SNAP_DURATION_RATIO = 0.02
const SEEK_SNAP_VERTICAL_DECAY = 15


function isAssSubtitleCodec(codec?: string) {
    if (!codec) return false

    const normalizedCodec = codec.trim().toLowerCase()
    return normalizedCodec === "ass" || normalizedCodec === "ssa"
}

export default function PlayerScreen() {
    return <PlayerScreenInner />
}

function PlayerScreenInner() {
    const DEFAULT_SUBTITLE_POSITION = 100
    const IOS_SUBTITLE_CROP_ADJUSTMENT_FACTOR = 0.7

    const { back, canGoBack, replace } = useRouter()
    const rawInsets = useSafeAreaInsets()
    const insets = React.useMemo(() => {
        if (Platform.OS === "android") {
            return {
                top: 0,
                bottom: 0,
                left: rawInsets.left,
                right: rawInsets.right,
            }
        }
        return rawInsets
    }, [rawInsets])
    const { width: windowWidth, height: windowHeight } = useWindowDimensions()

    const cleanupSession = useCleanupPlaybackSession()
    const serverUrl = useServerUrl()
    const isServerConnected = useIsServerConnected()

    useKeepAwake()
    useLandscapeOrientationLock()

    React.useEffect(() => {
        if (Platform.OS === "android") {
            void NavigationBar.setVisibilityAsync("hidden")
            void NavigationBar.setBehaviorAsync("overlay-swipe")
        }
        return () => {
            if (Platform.OS === "android") {
                void NavigationBar.setVisibilityAsync("visible")
                void NavigationBar.setBehaviorAsync("overlay-swipe")
            }
        }
    }, [])

    React.useEffect(() => {
        return () => {
            cleanupSession()
        }
    }, [cleanupSession])

    // atoms
    const source = useActivePlaybackSource()
    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlaybackIntent] = useAtom(animeEntryPlaybackIntentAtom)
    const loadingMessage = useAtomValue(playerLoadingMessageAtom)
    const error = useAtomValue(playerErrorAtom)
    const [nextEpisodePrompt, setNextEpisodePrompt] = React.useState<NextEpisodePrompt | null>(null)

    // player + prefs
    const [prefs, updatePrefs] = usePlayerPreferences()
    const player = useMpvPlayer()
    const { state } = player
    const playerSeekTo = player.seekTo
    const playerSetVideoZoom = player.setVideoZoom
    const playerSetSubtitlePosition = player.setSubtitlePosition
    const playerSetSubtitleMarginY = player.setSubtitleMarginY

    const { screenWidth, screenHeight } = React.useMemo(() => {
        if (state.isPiPActive) {
            return {
                screenWidth: windowWidth,
                screenHeight: windowHeight,
            }
        }
        if (Platform.OS === "android") {
            const screen = Dimensions.get("screen")
            return {
                screenWidth: Math.max(screen.width, screen.height),
                screenHeight: Math.min(screen.width, screen.height),
            }
        }
        return {
            screenWidth: windowWidth,
            screenHeight: windowHeight,
        }
    }, [windowWidth, windowHeight, state.isPiPActive])

    useContinuitySync(player.source, state)

    const { data: watchHistory } = useGetContinuityWatchHistory()
    const resumeAppliedForRef = React.useRef<string | null>(null)

    React.useEffect(() => {
        if (!source) return
        if (resumeAppliedForRef.current === source.id) return
        if (state.status !== "ready" || state.paused) return

        let resumeTarget = source.resumePositionSec != null && source.resumePositionSec > 0
            ? source.resumePositionSec
            : null

        if (resumeTarget === null && watchHistory) {
            const item = watchHistory[source.mediaId]
            if (item && item.episodeNumber === source.episodeNumber) {
                const ratio = item.duration > 0 ? item.currentTime / item.duration : 0
                if (ratio < 0.9 && ratio >= 0.02) {
                    resumeTarget = item.currentTime
                }
            }
        }

        if (resumeTarget === null) {
            resumeAppliedForRef.current = source.id
            return
        }

        if (Math.abs(state.currentTime - resumeTarget) <= 1.5) {
            resumeAppliedForRef.current = source.id
            return
        }

        resumeAppliedForRef.current = source.id
        playerSeekTo(resumeTarget)
    }, [playerSeekTo, source, state.currentTime, state.paused, state.status, watchHistory])

    const chapters = React.useMemo<PlayerChapter[]>(() => {
        return state.chapters.length > 0
            ? state.chapters
            : (source?.mkvMetadata?.chapters ?? []).map((chapter, index) => ({
                id: chapter.uid > 0 ? chapter.uid : index,
                start: chapter.start,
                title: chapter.text,
            }))
    }, [state.chapters, source?.mkvMetadata?.chapters])

    const {
        skipData,
        showSkipIntro,
        showSkipOutro,
    } = useSkipData({
        source,
        chapters,
        duration: state.duration,
        currentTime: state.currentTime,
        status: state.status,
        autoSkipOpEd: prefs.autoSkipOpEd,
        playerSeekTo,
    })

    const videoAspectRatio = getSourceVideoAspectRatio(source)
    const fillZoomScale = getFillZoomScale(screenWidth, screenHeight, videoAspectRatio)

    const nextEpisode = !source?.episodes || source.episodes.length === 0
        ? null
        : source.episodes.find(e => e.episodeNumber === source.episodeNumber + 1) ?? null

    const nextEpisodeNumber = nextEpisode
        ? nextEpisode.episodeNumber
        : !source?.media?.episodes || source.episodeNumber >= source.media.episodes
            ? null
            : source.episodeNumber + 1
    const nextLocalPlaybackSource = React.useMemo(() => {
        if (!source || source.nextEpisodeAction !== "local-file" || !nextEpisode) return null

        const isLocal = serverUrl ? isLocalServer(serverUrl) : false
        const effectiveServerUrl = source.serverLocalServerUrl
            ?? ((isServerConnected || isLocal) ? serverUrl : null)

        return getLocalEpisodePlaybackSource({
            mediaId: source.mediaId,
            episode: nextEpisode,
            media: source.media,
            entryListData: source.entryListData,
            episodes: source.episodes,
            serverUrl: effectiveServerUrl,
            entryView: source.entryView ?? "library",
            serverLocalIdentity: source.serverLocalIdentity,
        })
    }, [isServerConnected, nextEpisode, serverUrl, source])

    const gRef = React.useRef(createGestureRefs())

    const controls = useControlsVisibility(gRef)

    // settings panel
    const [panel, setPanel] = React.useState<PlayerPanel | null>(null)
    const closeSettings = React.useCallback(() => {
        setPanel(null)
        controls.scheduleHide()
    }, [controls.scheduleHide])

    // sync gRef every render
    syncGestureRef(gRef, {
        controlsVisible: controls.controlsVisible,
        controlsLocked: controls.controlsLocked,
        panel,
        isPiPActive: state.isPiPActive,
        paused: state.paused,
        currentTime: state.currentTime,
        duration: state.duration,
        speed: state.speed,
        prefs,
    })

    // sync controls visibility with paused state
    React.useEffect(() => {
        controls.syncWithPaused(state.paused)
    }, [state.paused, controls.syncWithPaused])

    // cleanup hide timer on unmount
    React.useEffect(() => controls.clearHideTimer, [controls.clearHideTimer])

    const doubleTap = useDoubleTapSeek()
    const sideAdjust = useSideAdjust()
    const swipeSeek = useSwipeSeek()

    // seek bar
    const barWidthRef = React.useRef(300)
    const [seekBarWidth, setSeekBarWidth] = React.useState(0)
    const seekBarWidthValue = useSharedValue(0)
    const seekBarProgress = useSharedValue(0)
    const seekBarThumbScale = useSharedValue(1)
    const seekBarTrackHeight = useSharedValue(6)
    const seekBarGlowOpacity = useSharedValue(0)
    const pendingSeekingDisplayRef = React.useRef<number | null>(null)
    const seekDisplayFrameRef = React.useRef<number | null>(null)
    const [seekingDisplay, setSeekingDisplay] = React.useState<number | null>(null)
    const seekingRef = React.useRef<number | null>(null)

    const onSeekBarLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
        const width = Math.max(1, e.nativeEvent.layout.width)
        barWidthRef.current = width
        setSeekBarWidth(current => current === width ? current : width)
        seekBarWidthValue.set(width)
    }

    const scheduleSeekingDisplayUpdate = React.useCallback((value: number | null) => {
        pendingSeekingDisplayRef.current = value
        if (value === null) {
            if (seekDisplayFrameRef.current !== null) {
                cancelAnimationFrame(seekDisplayFrameRef.current)
                seekDisplayFrameRef.current = null
            }
            setSeekingDisplay(null)
            return
        }
        if (seekDisplayFrameRef.current !== null) return
        seekDisplayFrameRef.current = requestAnimationFrame(() => {
            seekDisplayFrameRef.current = null
            const nextValue = pendingSeekingDisplayRef.current ?? null
            setSeekingDisplay(current => current === nextValue ? current : nextValue)
        })
    }, [])

    // cleanup rAF
    React.useEffect(() => {
        return () => {
            if (seekDisplayFrameRef.current !== null) cancelAnimationFrame(seekDisplayFrameRef.current)
        }
    }, [])

    const getSeekTargetFromBarX = React.useCallback((x: number) => {
        const frac = clamp(x / barWidthRef.current, 0, 1)
        return frac * gRef.current.duration
    }, [])

    const getSeekSnappedTime = React.useCallback((x: number, y: number) => {
        const rawTime = getSeekTargetFromBarX(x)
        const duration = gRef.current.duration
        if (duration <= 0) return rawTime

        const snapPoints = [0]
        if (chapters && chapters.length > 0) {
            for (const c of chapters) {
                if (c.start > 0 && c.start < duration) {
                    snapPoints.push(c.start)
                }
            }
        }
        snapPoints.push(duration)

        const verticalDist = Math.abs(y - 18)
        const maxThreshold = Math.min(SEEK_SNAP_MAX_THRESHOLD, duration * SEEK_SNAP_DURATION_RATIO)
        const threshold = Math.max(0, maxThreshold - (verticalDist / SEEK_SNAP_VERTICAL_DECAY))

        if (threshold <= 0) return rawTime

        let nearest = snapPoints[0]
        let minDiff = Math.abs(rawTime - nearest)

        for (let i = 1; i < snapPoints.length; i++) {
            const diff = Math.abs(rawTime - snapPoints[i])
            if (diff < minDiff) {
                minDiff = diff
                nearest = snapPoints[i]
            }
        }

        if (minDiff <= threshold) {
            return nearest
        }
        return rawTime
    }, [chapters, getSeekTargetFromBarX])

    const seekBarGesture = React.useMemo(() => {
        const tapGesture = Gesture.Tap()
            .maxDuration(250)
            .maxDistance(10)
            .runOnJS(true)
            .onBegin(() => {
                controls.clearHideTimer()
            })
            .onEnd((e, success) => {
                if (!success) return
                player.seekTo(getSeekSnappedTime(e.x, e.y))
                controls.scheduleHide()
            })

        const panGesture = Gesture.Pan()
            .minDistance(2)
            .onBegin((e) => {
                controls.clearHideTimer()
                const target = getSeekSnappedTime(e.x, e.y)
                seekingRef.current = target
                scheduleSeekingDisplayUpdate(target)
            })
            .onUpdate((e) => {
                const target = getSeekSnappedTime(e.x, e.y)
                seekingRef.current = target
                scheduleSeekingDisplayUpdate(target)
            })
            .onEnd(() => {
                const target = seekingRef.current
                seekingRef.current = null
                if (target !== null) player.seekTo(target)
                scheduleSeekingDisplayUpdate(null)
                controls.scheduleHide()
            })
            .onFinalize(() => {
                seekingRef.current = null
                scheduleSeekingDisplayUpdate(null)
            })
            .runOnJS(true)

        return Gesture.Race(tapGesture, panGesture)
    }, [controls.clearHideTimer, controls.scheduleHide, getSeekSnappedTime, player.seekTo, scheduleSeekingDisplayUpdate])

    // zoom
    const [zoomMode, setZoomMode] = React.useState<"fit" | "fill">("fit")
    const zoomScaleRef = React.useRef(1)
    const pinchStartScaleRef = React.useRef(1)

    const syncIosSubtitleCropCompensation = React.useCallback((scale: number) => {
        if (Platform.OS !== "ios") return
        if (screenWidth <= 0 || screenHeight <= 0 || videoAspectRatio <= 0) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const selectedSubtitleTrack = state.subtitleTracks.find(track => track.id === state.activeSubtitleTrackId)
            ?? state.subtitleTracks.find(track => track.selected)
        if (!selectedSubtitleTrack) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const clampedScale = Math.max(1, scale)
        const containerAspectRatio = screenWidth / screenHeight
        const baseVideoHeight = containerAspectRatio > videoAspectRatio
            ? screenHeight
            : screenWidth / videoAspectRatio
        const scaledVideoHeight = baseVideoHeight * clampedScale

        if (scaledVideoHeight <= screenHeight + 0.5) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const croppedBottomPercent = ((scaledVideoHeight - screenHeight) / (2 * scaledVideoHeight)) * 100
        if (!isAssSubtitleCodec(selectedSubtitleTrack.codec)) {
            const croppedBottomPixels = (scaledVideoHeight - screenHeight) / 2
            const extraMargin = Math.round((croppedBottomPixels * 720) / screenHeight)

            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y + extraMargin)
            return
        }

        // ASS subtitles are already positioned within their own script layout, so
        // keep the existing position lift and only reset any text-subtitle margin.
        playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
        const compensatedPosition = Math.round(clamp(
            DEFAULT_SUBTITLE_POSITION - (croppedBottomPercent * IOS_SUBTITLE_CROP_ADJUSTMENT_FACTOR),
            0,
            DEFAULT_SUBTITLE_POSITION,
        ))
        playerSetSubtitlePosition(compensatedPosition)
    }, [
        playerSetSubtitleMarginY,
        playerSetSubtitlePosition,
        screenHeight,
        screenWidth,
        state.activeSubtitleTrackId,
        state.subtitleTracks,
        videoAspectRatio,
    ])

    const applyVideoZoom = React.useCallback((scale: number) => {
        const clampedScale = Math.max(1, scale)
        if (Math.abs(zoomScaleRef.current - clampedScale) < 0.001) return
        zoomScaleRef.current = clampedScale
        setZoomMode(current => {
            const nextMode = clampedScale > 1.001 ? "fill" : "fit"
            return current === nextMode ? current : nextMode
        })
        playerSetVideoZoom(clampedScale)
        syncIosSubtitleCropCompensation(clampedScale)
    }, [playerSetVideoZoom, syncIosSubtitleCropCompensation])

    const applyZoomMode = React.useCallback((mode: "fit" | "fill") => {
        setZoomMode(mode)
        if (mode === "fit") {
            zoomScaleRef.current = 1
            playerSetVideoZoom(1)
            syncIosSubtitleCropCompensation(1)
        }
        controls.showControls()
    }, [controls.showControls, playerSetVideoZoom, syncIosSubtitleCropCompensation])

    React.useEffect(() => {
        setZoomMode("fit")
        zoomScaleRef.current = 1
        pinchStartScaleRef.current = 1
        playerSetVideoZoom(1)
        if (Platform.OS === "ios") {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
        }
    }, [playerSetSubtitleMarginY, playerSetSubtitlePosition, playerSetVideoZoom, source?.id])

    React.useEffect(() => {
        syncIosSubtitleCropCompensation(zoomScaleRef.current)
    }, [syncIosSubtitleCropCompensation])

    // fast forward
    const [isFastForwarding, setIsFastForwarding] = React.useState(false)
    const savedSpeedRef = React.useRef(1.0)
    const controlsVisibleBeforeLongPressRef = React.useRef(true)

    // center-tap feedback
    const centerTapHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const [centerTapFeedback, setCenterTapFeedback] = React.useState<"play" | "pause" | null>(null)

    React.useEffect(() => {
        return () => { if (centerTapHideTimerRef.current) clearTimeout(centerTapHideTimerRef.current) }
    }, [])

    React.useEffect(() => {
        if (!state.isPiPActive) return

        controls.clearHideTimer()
        controls.setControlsVisible(false)
        setPanel(null)
        setIsFastForwarding(false)
        setCenterTapFeedback(null)
    }, [state.isPiPActive])

    // player gestures
    const { screenGesture } = usePlayerGestures({
        gRef, screenWidth, screenHeight, fillZoomScale,

        clearHideTimer: controls.clearHideTimer,
        scheduleHide: controls.scheduleHide,
        showControls: controls.showControls,
        toggleControls: controls.toggleControls,
        closeSettings,
        setControlsVisible: controls.setControlsVisible,

        seekTo: player.seekTo,
        seekRelative: player.seekRelative,
        togglePlayPause: player.togglePlayPause,
        setPlayerSpeed: player.setSpeed,

        applyVideoZoom,
        applyZoomMode,
        zoomScaleRef,
        pinchStartScaleRef,

        showDoubleTapIndicator: doubleTap.showDoubleTapIndicator,

        swipeStartTimeRef: swipeSeek.swipeStartTimeRef,
        swipeActivatedRef: swipeSeek.swipeActivatedRef,
        swipeStartXRef: swipeSeek.swipeStartXRef,
        swipeSeekingRef: swipeSeek.swipeSeekingRef,
        panGestureModeRef: swipeSeek.panGestureModeRef,
        scheduleSwipeSeekingUpdate: swipeSeek.scheduleSwipeSeekingUpdate,

        brightnessLevelRef: sideAdjust.brightnessLevelRef,
        volumeLevelRef: sideAdjust.volumeLevelRef,
        sideAdjustKindRef: sideAdjust.sideAdjustKindRef,
        sideAdjustStartYRef: sideAdjust.sideAdjustStartYRef,
        sideAdjustStartValueRef: sideAdjust.sideAdjustStartValueRef,
        sideAdjustActivatedRef: sideAdjust.sideAdjustActivatedRef,
        scheduleSideAdjustHide: sideAdjust.scheduleSideAdjustHide,
        scheduleSideAdjustUpdate: sideAdjust.scheduleSideAdjustUpdate,

        savedSpeedRef,
        controlsVisibleBeforeLongPressRef,
        setIsFastForwarding,

        setCenterTapFeedback,
        centerTapHideTimerRef,
    })

    // navigation
    const handleBack = React.useCallback(() => {
        player.stop()
        if (canGoBack()) back()
    }, [back, canGoBack, player])

    const closePlayerToEntry = React.useCallback((view: MobilePlaybackSource["entryView"], mediaId: number) => {
        player.stop()
        if (canGoBack()) {
            back()
            return
        }
        if (!view) return
        replace({
            pathname: "/(app)/entry/anime/[id]",
            params: { id: String(mediaId), initialView: view },
        })
    }, [back, canGoBack, player, replace])

    // next episode logic
    const canPlayNext = React.useMemo(() => {
        if (!source) return false
        if (source.nextEpisodeAction === "local-file") return Boolean(nextLocalPlaybackSource)
        if (source.nextEpisodeAction === "torrentstream-auto-select"
            || source.nextEpisodeAction === "torrentstream-previous-batch"
            || source.nextEpisodeAction === "torrentstream-manual"
            || source.nextEpisodeAction === "debridstream-auto-select"
            || source.nextEpisodeAction === "debridstream-previous-batch"
            || source.nextEpisodeAction === "debridstream-manual"
            || source.nextEpisodeAction === "onlinestream-play") {
            return nextEpisodeNumber !== null
        }
        return false
    }, [nextEpisodeNumber, nextLocalPlaybackSource, source])

    const nextEpisodeLabel = nextEpisode?.displayTitle
        ?? (nextEpisodeNumber ? `Episode ${nextEpisodeNumber}` : "the next episode")

    const canAutoAdvance = canPlayNext
        && source?.nextEpisodeAction !== "torrentstream-manual"
        && source?.nextEpisodeAction !== "debridstream-manual"
    const remainingTime = Math.max(0, state.duration - state.currentTime)

    const playEpisodeSelection = React.useCallback((episode: Anime_Episode | null, episodeNumber: number | null) => {
        if (!source) return

        if (source.nextEpisodeAction === "local-file") {
            if (!episode) return
            const isLocal = serverUrl ? isLocalServer(serverUrl) : false
            const effectiveServerUrl = source.serverLocalServerUrl
                ?? ((isServerConnected || isLocal) ? serverUrl : null)
            const newSource = getLocalEpisodePlaybackSource({
                mediaId: source.mediaId,
                episode,
                media: source.media,
                entryListData: source.entryListData,
                episodes: source.episodes,
                serverUrl: effectiveServerUrl,
                entryView: source.entryView ?? "library",
                serverLocalIdentity: source.serverLocalIdentity,
            })
            if (!newSource) {
                if (!isServerConnected) {
                    toast.info("Episode isn't downloaded on this device")
                }
                return
            }
            setSource(newSource)
            controls.scheduleHide()
            return
        }

        if (!episodeNumber) return

        if (source.nextEpisodeAction === "torrentstream-auto-select") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "torrentstream-auto-select", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "torrentstream-previous-batch") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "torrentstream-previous-batch", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "torrentstream-manual") {
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-auto-select") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "debridstream-auto-select", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-previous-batch") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "debridstream-previous-batch", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-manual") {
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "onlinestream-play") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "onlinestream-play", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "onlinestream", source.mediaId)
        }
    }, [closePlayerToEntry, controls.scheduleHide, isServerConnected, serverUrl, setPlaybackIntent, setSource, source])

    const playNextEpisode = React.useCallback(() => {
        playEpisodeSelection(nextEpisode, nextEpisodeNumber)
    }, [nextEpisode, nextEpisodeNumber, playEpisodeSelection])

    const dismissNextEpisodePrompt = React.useCallback(() => {
        setNextEpisodePrompt(null)
        if (state.paused) {
            controls.clearHideTimer()
            return
        }

        controls.scheduleHide()
    }, [controls, state.paused])

    const confirmNextEpisodePrompt = React.useCallback(() => {
        setNextEpisodePrompt(null)
        playNextEpisode()
    }, [playNextEpisode])

    const autoNext = useAutoNextEpisode({
        sourceId: source?.id,
        canAutoAdvance,
        isPiPActive: state.isPiPActive,
        autoNextEnabled: prefs.autoNextEpisode,
        paused: state.paused,
        currentTime: state.currentTime,
        duration: state.duration,
        remainingTime,
        eofReached: state.eofReached,
        playNextEpisode,
    })

    const shouldConfirmEarlySkip = state.duration > 0
        && remainingTime > NEXT_EPISODE_CONFIRM_REMAINING_SECONDS
        && (state.currentTime / state.duration) < NEXT_EPISODE_CONFIRM_PROGRESS_THRESHOLD

    React.useEffect(() => {
        setNextEpisodePrompt(null)
    }, [source?.id])

    function handleManualNextEpisode() {
        if (!source || !canPlayNext) return
        autoNext.cancelAutoNext()
        controls.clearHideTimer()

        if (source.nextEpisodeAction === "torrentstream-manual" || source.nextEpisodeAction === "debridstream-manual") {
            setNextEpisodePrompt({
                title: "Choose next episode source?",
                description: `Continuing to ${nextEpisodeLabel} will return you to the source picker.`,
                confirmLabel: "Continue",
            })
            return
        }
        if (shouldConfirmEarlySkip) {
            setNextEpisodePrompt({
                title: "Play next episode?",
                description: `${formatTime(remainingTime)} is still left in this episode. Start ${nextEpisodeLabel} now?`,
                confirmLabel: "Play next",
            })
            return
        }
        playNextEpisode()
    }

    // episode list selection
    const handleEpisodeSelect = React.useCallback((episode: Anime_Episode) => {
        if (!source) return
        if (episode.episodeNumber === source.episodeNumber) {
            setPanel(null)
            return
        }

        setPanel(null)
        playEpisodeSelection(episode, episode.episodeNumber)
    }, [playEpisodeSelection, source])

    // settings callbacks
    function handleSetSpeed(speed: number) {
        player.setSpeed(speed)
        updatePrefs({ speed })
    }

    function handleSubDelayChange(delta: number) {
        const v = Math.round((state.subtitleDelay + delta) * 10) / 10
        player.setSubtitleDelay(v)
        updatePrefs({ subtitleDelay: v })
    }

    function handleSubDelayReset() {
        player.setSubtitleDelay(0)
        updatePrefs({ subtitleDelay: 0 })
    }

    function handleAudioDelayChange(delta: number) {
        const v = Math.round((state.audioDelay + delta) * 10) / 10
        player.setAudioDelay(v)
        updatePrefs({ audioDelay: v })
    }

    function handleAudioDelayReset() {
        player.setAudioDelay(0)
        updatePrefs({ audioDelay: 0 })
    }

    function handleSubFontSize(size: number) {
        player.setSubtitleFontSize(size)
        updatePrefs({ subtitleFontSize: size })
    }

    function handleStartPiP() {
        controls.clearHideTimer()
        setPanel(null)
        controls.setControlsVisible(false)
        setIsFastForwarding(false)
        setCenterTapFeedback(null)
        requestAnimationFrame(() => { requestAnimationFrame(() => { player.startPiP() }) })
    }

    // display calculations
    const displayTime = swipeSeek.swipeSeeking?.currentTime ?? seekingDisplay ?? state.currentTime
    const progressRatio = state.duration > 0 ? clamp(displayTime / state.duration, 0, 1) : 0
    const isPiPActive = state.isPiPActive
    const isSeeking = seekingDisplay !== null || swipeSeek.swipeSeeking !== null
    const seekingChapter = isSeeking ? getChapterAtTime(chapters, displayTime) : undefined

    const chapterMarkers = (() => {
        if (!chapters || chapters.length <= 1 || state.duration <= 0 || seekBarWidth <= 0) return []
        return chapters.flatMap((chapter, index) => {
            if (!(chapter.start > 0)) return []
            const markerProgress = clamp(chapter.start / state.duration, 0, 1)
            if (!isFinite(markerProgress) || markerProgress <= 0.001 || markerProgress >= 0.999) return []
            return [{
                key: `chapter-${chapter.id}-${index}-${chapter.start}`,
                left: clamp((markerProgress * seekBarWidth) - 1, 0, Math.max(seekBarWidth - 2, 0)),
                progress: markerProgress,
            }]
        })
    })()

    // seek bar animated styles
    React.useEffect(() => {
        if (state.duration <= 0) {
            seekBarProgress.set(0)
            return
        }

        seekBarProgress.set(isSeeking ? progressRatio : withTiming(progressRatio, { duration: 180 }))
    }, [isSeeking, progressRatio, seekBarProgress, state.duration])

    React.useEffect(() => {
        seekBarThumbScale.set(withTiming(isSeeking ? 1.35 : 1, { duration: 140 }))
        seekBarTrackHeight.set(withTiming(isSeeking ? 8 : 6, { duration: 140 }))
        seekBarGlowOpacity.set(withTiming(isSeeking ? 1 : 0, { duration: 180 }))
    }, [isSeeking, seekBarGlowOpacity, seekBarThumbScale, seekBarTrackHeight])

    const seekBarTrackStyle = useAnimatedStyle(() => ({ height: seekBarTrackHeight.value }))
    const seekBarFillStyle = useAnimatedStyle(() => ({ width: seekBarWidthValue.value * seekBarProgress.value }))
    const seekBarThumbStyle = useAnimatedStyle(() => {
        const w = seekBarWidthValue.value
        const thumbLeft = clamp((w * seekBarProgress.value) - 6, 0, Math.max(w - 12, 0))
        return {
            opacity: w > 0 ? 1 : 0,
            transform: [{ translateX: thumbLeft }, { scale: seekBarThumbScale.value }],
        }
    })
    const seekBarGlowStyle = useAnimatedStyle(() => ({ opacity: seekBarGlowOpacity.value }))

    // horizontal safe-area padding for overlays
    const extendHudPastHorizontalSafeArea = Platform.OS === "ios" && zoomMode === "fill"
    const padL = extendHudPastHorizontalSafeArea ? 24 : insets.left + 16
    const padR = extendHudPastHorizontalSafeArea ? 24 : insets.right + 16

    // error screen
    if (error) {
        return (
            <View className="flex-1 bg-black items-center justify-center px-6">
                <StatusBar hidden />
                <Text className="text-red-400 text-lg font-semibold mb-2">Playback Error</Text>
                <Text className="text-white/70 text-center mb-6">{error}</Text>
                <Pressable onPress={handleBack} className="bg-white/10 px-6 py-3 rounded-xl">
                    <Text className="text-white font-medium">Go Back</Text>
                </Pressable>
            </View>
        )
    }

    // loading screen
    if (loadingMessage && !source) {
        return (
            <View className="flex-1 bg-black items-center justify-center">
                <StatusBar hidden />
                <ActivityIndicator size="large" color="#ffffff" />
                <Text className="text-white/70 mt-4 text-base">{loadingMessage}</Text>
            </View>
        )
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <View
                className="bg-black flex-1 w-full h-full"
                style={{
                    backgroundColor: "black",
                }}
            >
                <StatusBar hidden />


                <View style={{ flex: 1, width: "100%", height: "100%", position: "relative", justifyContent: "center" }}>
                    <MpvPlayerView
                        ref={player.viewRef}
                        source={player.videoSource}
                        nowPlayingMetadata={player.nowPlayingMetadata}
                        {...(Platform.OS === "android" ? { videoOutput: prefs.androidVideoOutput } : {})}
                        onLoad={player.onNativeLoad}
                        onProgress={player.onNativeProgress}
                        onPlaybackStateChange={player.onNativePlaybackStateChange}
                        onPictureInPictureChange={player.onNativePictureInPictureChange}
                        onError={player.onNativeError}
                        onTracksReady={player.onNativeTracksReady}
                        style={{ width: "100%", height: "100%" }}
                    />
                </View>


                {state.status === "buffering" && !isPiPActive && (
                    <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                        <ActivityIndicator size="large" color="#ffffff" />
                    </View>
                )}



                <GestureDetector gesture={screenGesture}>
                    <Animated.View
                        collapsable={false}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                    />
                </GestureDetector>


                {!isPiPActive && (
                    <ControlsOverlay
                        visible={controls.controlsVisible && !controls.controlsLocked}
                        source={source}
                        state={state}
                        insets={insets}
                        zoomMode={zoomMode}
                        panel={panel}
                        seekBarGesture={seekBarGesture}
                        onSeekBarLayout={onSeekBarLayout}
                        seekBarTrackStyle={seekBarTrackStyle}
                        seekBarFillStyle={seekBarFillStyle}
                        seekBarThumbStyle={seekBarThumbStyle}
                        seekBarGlowStyle={seekBarGlowStyle}
                        chapterMarkers={chapterMarkers}
                        progressRatio={progressRatio}
                        displayTime={displayTime}
                        isSeeking={isSeeking}
                        seekingChapter={seekingChapter}
                        onBack={handleBack}
                        onTogglePlayPause={player.togglePlayPause}
                        scheduleHide={controls.scheduleHide}
                        clearHideTimer={controls.clearHideTimer}
                        setPanel={setPanel}
                        canPlayNext={canPlayNext}
                        onManualNextEpisode={handleManualNextEpisode}
                        chapters={chapters}
                        seekBarProgress={seekBarProgress}
                        onLockScreen={controls.lockScreen}
                        onSeekRelative={player.seekRelative}
                        buttonSeekSec={prefs.buttonSeekSec}
                    />
                )}


                {controls.controlsVisible && controls.controlsLocked && !isPiPActive && (
                    <LockModeOverlay insets={insets} onUnlock={controls.handleUnlockScreen} />
                )}


                {autoNext.autoNextCountdown !== null && !isPiPActive && canAutoAdvance && (
                    <AutoNextCard
                        countdown={autoNext.autoNextCountdown}
                        nextEpisodeLabel={nextEpisodeLabel}
                        controlsVisible={controls.controlsVisible}
                        controlsLocked={controls.controlsLocked}
                        padR={padR}
                        insets={insets}
                        onCancel={autoNext.cancelAutoNext}
                        onPlayNow={autoNext.triggerAutoNext}
                    />
                )}

                {nextEpisodePrompt && !isPiPActive && (
                    <NextEpisodeConfirmCard
                        title={nextEpisodePrompt.title}
                        description={nextEpisodePrompt.description}
                        confirmLabel={nextEpisodePrompt.confirmLabel}
                        insets={insets}
                        onCancel={dismissNextEpisodePrompt}
                        onConfirm={confirmNextEpisodePrompt}
                    />
                )}

                {!isPiPActive && !controls.controlsLocked && (showSkipIntro || showSkipOutro) && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(150)}
                        style={{
                            position: "absolute",
                            bottom: Math.max(80, insets.bottom + 64),
                            right: Math.max(20, insets.right + 20),
                            zIndex: 50,
                        }}
                    >
                        <Pressable
                            onPress={() => {
                                const targetTime = showSkipIntro ? skipData.op!.interval.endTime : skipData.ed!.interval.endTime
                                playerSeekTo(targetTime)
                                toast.info(showSkipIntro ? "Skipped opening intro" : "Skipped ending outro")
                            }}
                        >
                            {({ pressed }) => (
                                <View
                                    className={cn(
                                        "flex-row items-center gap-1.5 rounded-full border border-white/5 bg-black/60 px-3 py-1.5",
                                        pressed ? "opacity-75 bg-white/5" : "opacity-100",
                                    )}
                                >
                                    <Text className="text-xs font-medium text-white/90">
                                        {showSkipIntro ? "Skip Intro" : "Skip Outro"}
                                    </Text>
                                    <SkipForward size={11} color="rgba(255,255,255,0.9)" />
                                </View>
                            )}
                        </Pressable>
                    </Animated.View>
                )}

                {isFastForwarding && !isPiPActive && (
                    <FastForwardBadge speed={prefs.longPressFastForwardSpeed} />
                )}

                {swipeSeek.swipeSeeking && !isPiPActive && (
                    <SwipeSeekOverlay
                        swipeSeeking={swipeSeek.swipeSeeking}
                        duration={state.duration}
                        seekingChapter={seekingChapter}
                    />
                )}

                {!isPiPActive && (
                    <DoubleTapFlash
                        side={doubleTap.doubleTapSide}
                        amount={doubleTap.doubleTapAmount}
                        screenWidth={screenWidth}
                        animatedStyle={doubleTap.doubleTapIndicatorStyle}
                    />
                )}

                {centerTapFeedback && !isPiPActive && (
                    <CenterTapFeedback feedback={centerTapFeedback} />
                )}

                {sideAdjust.sideAdjustFeedbackKind && !isPiPActive && (
                    <SideAdjustHUD
                        kind={sideAdjust.sideAdjustFeedbackKind}
                        progress={sideAdjust.sideAdjustProgress}
                        initialProgress={
                            sideAdjust.sideAdjustFeedbackKind === "brightness"
                                ? sideAdjust.brightnessLevelRef.current
                                : sideAdjust.volumeLevelRef.current
                        }
                        insets={insets}
                        screenHeight={screenHeight}
                        padL={padL}
                        padR={padR}
                        sideAdjustFillStyle={sideAdjust.sideAdjustFillStyle}
                    />
                )}

                {panel && !isPiPActive && (
                    <PlayerPanelOverlay
                        panel={panel}
                        onNavigate={setPanel}
                        onClose={closeSettings}
                        insets={insets}
                        state={state}
                        prefs={prefs}
                        updatePrefs={updatePrefs}
                        onSetSpeed={handleSetSpeed}
                        onSubDelayChange={handleSubDelayChange}
                        onSubDelayReset={handleSubDelayReset}
                        onAudioDelayChange={handleAudioDelayChange}
                        onAudioDelayReset={handleAudioDelayReset}
                        onSetSubFontSize={handleSubFontSize}
                        onSetAudioTrack={player.setAudioTrack}
                        onSetSubtitleTrack={player.setSubtitleTrack}
                        onAddExternalSubtitle={player.addSubtitleFile ? (url: string) => player.addSubtitleFile(url, true) : undefined}
                        anilistId={source?.mediaId}
                        wyzieApiKey={prefs.wyzieApiKey}
                        onSaveWyzieApiKey={(value) => updatePrefs({ wyzieApiKey: value })}
                        onStartPiP={handleStartPiP}
                        onToggleAutoNext={() => updatePrefs({ autoNextEpisode: !prefs.autoNextEpisode })}
                        onToggleCenterTapPlayPause={() => updatePrefs({ centerTapPlayPause: !prefs.centerTapPlayPause })}
                        onToggleSideSwipeControls={() => updatePrefs({ sideSwipeBrightnessVolume: !prefs.sideSwipeBrightnessVolume })}
                        onToggleAutoSkipOpEd={() => updatePrefs({ autoSkipOpEd: !prefs.autoSkipOpEd })}
                        onLockScreen={controls.lockScreen}
                        episodes={source?.episodes}
                        currentEpisodeNumber={source?.episodeNumber}
                        onPlayEpisode={handleEpisodeSelect}
                    />
                )}
            </View>
        </GestureHandlerRootView>
    )
}

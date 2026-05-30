import { playerErrorAtom, playerLoadingMessageAtom } from "@/lib/player"
import type { MobilePlaybackSource, PlayerState } from "@/lib/player"
import { logger } from "@/lib/utils/logger"
import type {
    MpvPlayerViewRef,
    MpvVideoSource,
    NowPlayingMetadata,
    OnErrorEventPayload,
    OnLoadEventPayload,
    OnPlaybackStateChangePayload,
    OnProgressEventPayload,
    SubtitleHorizontalAlignment,
    SubtitleVerticalAlignment,
} from "expo-mpv-player"
import { useAtomValue } from "jotai/react"
import React from "react"
import { findPreferredTrack, getPlayerPreferences, setPlayerPreferences } from "./player-preferences"
import { useActivePlaybackSource } from "./session"

const log = logger("use-mpv-player")

type NativeEvent<T> = { nativeEvent: T }

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function isMissingMpvViewError(error: unknown) {
    const message = getErrorMessage(error)
    return message.includes("MpvSurfaceExpoView")
        && (message.includes("Unable to find") || message.includes("cannot be cast"))
}

function getMediaTitle(source: MobilePlaybackSource): string | undefined {
    return source.media?.title?.userPreferred
        ?? source.media?.title?.english
        ?? source.media?.title?.romaji
        ?? source.media?.title?.native
}

function getEpisodeLabel(source: MobilePlaybackSource): string | undefined {
    const displayTitle = source.episode?.displayTitle?.trim()
    const episodeTitle = source.episode?.episodeTitle?.trim()

    if (displayTitle && episodeTitle) return `${displayTitle} - ${episodeTitle}`
    return displayTitle || episodeTitle || undefined
}

const INITIAL_STATE: PlayerState = {
    status: "idle",
    paused: true,
    currentTime: 0,
    duration: 0,
    eofReached: false,
    chapters: [],
    audioTracks: [],
    subtitleTracks: [],
    activeAudioTrackId: null,
    activeSubtitleTrackId: null,
    speed: 1.0,
    subtitleDelay: 0,
    audioDelay: 0,
    isPiPActive: false,
}

/**
 * A React hook that bridges the native ExpoMpvPlayer view to the UI.
 *
 * It:
 * - Builds a `MpvVideoSource` from the `currentPlaybackSourceAtom`
 * - Provides event handlers to pass as props to `<MpvPlayerView>`
 * - Manages React state from native events (no polling)
 * - Provides imperative control callbacks via the view ref
 * - Handles auto track selection, preferences, and cleanup
 */
export function useMpvPlayer() {
    const source = useActivePlaybackSource()
    const loadingMessage = useAtomValue(playerLoadingMessageAtom)
    const error = useAtomValue(playerErrorAtom)

    const viewRef = React.useRef<MpvPlayerViewRef>(null)
    const [state, setState] = React.useState(INITIAL_STATE)
    const loadedSourceId = React.useRef<string | null>(null)
    const durationRef = React.useRef(0)

    // track whether we've applied auto-track + auto-play for the current source
    const hasAppliedDefaultTracks = React.useRef(false)
    const hasAppliedPrefs = React.useRef(false)

    // debounce isLoading -> "buffering" to avoid spinner flashing during seeks
    const bufferingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    // ---------------------------------------------------------------------------
    // Build the video source prop from the atom
    // ---------------------------------------------------------------------------
    const videoSource = React.useMemo<MpvVideoSource | undefined>(() => {
        if (!source) return undefined

        const prefs = getPlayerPreferences()

        return {
            url: source.url,
            headers: source.headers,
            externalSubtitles: source.externalSubtitles?.map(s => ({
                url: s.url,
                title: s.language || undefined,
            })),
            startPosition: source.resumePositionSec,
            autoplay: prefs.autoPlay,
        }
    }, [source])
    const shouldAutoplay = videoSource?.autoplay ?? true

    const nowPlayingMetadata = React.useMemo<NowPlayingMetadata | undefined>(() => {
        if (!source) return undefined

        const mediaTitle = getMediaTitle(source)
        const episodeLabel = getEpisodeLabel(source)
        const artworkUri = source.media?.coverImage?.extraLarge
            ?? source.media?.coverImage?.large
            ?? source.media?.coverImage?.medium
            ?? source.media?.bannerImage

        const title = episodeLabel ?? mediaTitle ?? `Episode ${source.episodeNumber}`
        const artist = episodeLabel ? mediaTitle : undefined

        if (!title && !artist && !artworkUri) return undefined

        return {
            title,
            artist,
            albumTitle: mediaTitle,
            artworkUri,
        }
    }, [source])

    // ---------------------------------------------------------------------------
    // Reset state when source changes
    // ---------------------------------------------------------------------------
    React.useLayoutEffect(() => {
        if (!source) return
        if (source.id === loadedSourceId.current) return

        loadedSourceId.current = source.id
        durationRef.current = 0
        hasAppliedDefaultTracks.current = false
        hasAppliedPrefs.current = false
        if (bufferingTimerRef.current !== null) {
            clearTimeout(bufferingTimerRef.current)
            bufferingTimerRef.current = null
        }
        setState({ ...INITIAL_STATE, status: "loading", paused: !shouldAutoplay })
    }, [shouldAutoplay, source])

    // cleanup buffering debounce timer on unmount
    React.useEffect(() => {
        return () => {
            if (bufferingTimerRef.current !== null) {
                clearTimeout(bufferingTimerRef.current)
            }
        }
    }, [])

    // ---------------------------------------------------------------------------
    // Native event handlers (passed as props to MpvPlayerView)
    // ---------------------------------------------------------------------------
    const onNativeLoad = React.useCallback((event: NativeEvent<OnLoadEventPayload>) => {
        log.info("Native load event")

        if (event.nativeEvent.url !== videoSource?.url) return

        setState(current => {
            const nextPaused = !shouldAutoplay
            if (current.paused === nextPaused) return current
            return { ...current, paused: nextPaused }
        })
    }, [shouldAutoplay, videoSource?.url])

    const onNativeProgress = React.useCallback((event: NativeEvent<OnProgressEventPayload>) => {
        const { position, duration, cacheSeconds: _cache } = event.nativeEvent
        durationRef.current = duration

        setState(s => {
            if (s.currentTime === position && s.duration === duration) return s
            return { ...s, currentTime: position, duration }
        })
    }, [])

    const onNativePlaybackStateChange = React.useCallback((event: NativeEvent<OnPlaybackStateChangePayload>) => {
        const payload = event.nativeEvent

        // Handle isLoading with debounce to avoid spinner flashing during seeks.
        // The native layer sends rapid isLoading true/false from MPV_EVENT_SEEK,
        // paused-for-cache, and MPV_EVENT_PLAYBACK_RESTART. Debounce the true
        // transition so short buffering bursts are invisible.
        if (payload.isLoading !== undefined) {
            if (payload.isLoading) {
                // delay showing buffering by 300ms
                if (bufferingTimerRef.current === null) {
                    bufferingTimerRef.current = setTimeout(() => {
                        bufferingTimerRef.current = null
                        setState(s => s.status === "buffering" ? s : { ...s, status: "buffering" })
                    }, 300)
                }
            } else {
                // loading resolved, cancel pending timer and set ready immediately
                if (bufferingTimerRef.current !== null) {
                    clearTimeout(bufferingTimerRef.current)
                    bufferingTimerRef.current = null
                }
                setState(s => {
                    if (s.status !== "buffering" && s.status !== "idle" && s.status !== "loading") return s
                    return { ...s, status: "ready" }
                })
            }
        }

        setState(s => {
            const next = { ...s }

            if (payload.isPaused !== undefined) {
                next.paused = payload.isPaused
            }
            if (payload.isReadyToSeek !== undefined && payload.isReadyToSeek) {
                if (next.status === "idle" || next.status === "loading") {
                    next.status = "ready"
                }
            }
            if (payload.eofReached !== undefined) {
                next.eofReached = payload.eofReached
            }
            if (payload.isPiPActive !== undefined) {
                next.isPiPActive = payload.isPiPActive
            }
            if (payload.speed !== undefined) {
                next.speed = payload.speed
            }
            if (payload.subtitleDelay !== undefined) {
                next.subtitleDelay = payload.subtitleDelay
            }
            if (payload.audioDelay !== undefined) {
                next.audioDelay = payload.audioDelay
            }

            return next
        })
    }, [])

    const onNativeError = React.useCallback((event: NativeEvent<OnErrorEventPayload>) => {
        log.warning("Native error:", event.nativeEvent.error)
        setState(s => ({ ...s, status: "error" }))
    }, [])

    const onNativeTracksReady = React.useCallback(async () => {
        const ref = viewRef.current
        if (!ref) return

        try {
            const [subTracks, audioTracks] = await Promise.all([
                ref.getSubtitleTracks(),
                ref.getAudioTracks(),
            ])

            const mappedSubs = subTracks.map(t => ({
                id: t.id,
                type: "subtitle" as const,
                title: t.title,
                language: t.lang,
                codec: t.codec,
                selected: t.selected,
            }))
            const mappedAudio = audioTracks.map(t => ({
                id: t.id,
                type: "audio" as const,
                title: t.title,
                language: t.lang,
                codec: t.codec,
                selected: t.selected,
            }))

            setState(s => ({
                ...s,
                subtitleTracks: mappedSubs,
                audioTracks: mappedAudio,
                activeSubtitleTrackId: mappedSubs.find(t => t.selected)?.id ?? null,
                activeAudioTrackId: mappedAudio.find(t => t.selected)?.id ?? null,
            }))
        }
        catch (e) {
            if (!isMissingMpvViewError(e)) {
                log.warning("Failed to fetch tracks", e)
            }
        }
    }, [])

    const handleNativeCommandError = React.useCallback((command: string, error: unknown) => {
        if (isMissingMpvViewError(error)) return
        log.warning(`Native command failed: ${command}`, error)
    }, [])

    const runNativeCommand = React.useCallback((
        command: string,
        invoke: (ref: MpvPlayerViewRef) => Promise<void>,
    ) => {
        const ref = viewRef.current
        if (!ref) return

        void invoke(ref).catch(error => handleNativeCommandError(command, error))
    }, [handleNativeCommandError])

    // ---------------------------------------------------------------------------
    // Auto-apply preferences after load
    // ---------------------------------------------------------------------------
    React.useEffect(() => {
        if (hasAppliedPrefs.current) return
        if (state.status !== "ready" && state.status !== "buffering") return
        if (!viewRef.current) return

        hasAppliedPrefs.current = true
        const prefs = getPlayerPreferences()
        runNativeCommand("setSpeed", ref => ref.setSpeed(prefs.speed))
        runNativeCommand("setSubtitleDelay", ref => ref.setSubtitleDelay(prefs.subtitleDelay))
        runNativeCommand("setAudioDelay", ref => ref.setAudioDelay(prefs.audioDelay))
        runNativeCommand("setSubtitleFontSize", ref => ref.setSubtitleFontSize(prefs.subtitleFontSize))
        runNativeCommand("setSubtitleVisibility", ref => ref.setSubtitleVisibility(prefs.showSubtitles))
        runNativeCommand("setSubtitlePosition", ref => ref.setSubtitlePosition(100))
    }, [runNativeCommand, state.status])

    // ---------------------------------------------------------------------------
    // Auto-select preferred audio/subtitle tracks once tracks appear
    // ---------------------------------------------------------------------------
    React.useEffect(() => {
        if (hasAppliedDefaultTracks.current) return
        if (state.audioTracks.length === 0 && state.subtitleTracks.length === 0) return
        if (!viewRef.current) return

        hasAppliedDefaultTracks.current = true
        const prefs = getPlayerPreferences()

        const preferredAudio = findPreferredTrack(state.audioTracks, prefs.preferredAudioLanguages)
        if (preferredAudio !== null) {
            const currentAudio = state.audioTracks.find(t => t.selected)
            if (currentAudio?.id !== preferredAudio) {
                log.info(`Auto-selecting preferred audio track: ${preferredAudio}`)
                runNativeCommand("setAudioTrack", nativeRef => nativeRef.setAudioTrack(preferredAudio))
            }
        }

        const preferredSub = findPreferredTrack(state.subtitleTracks, prefs.preferredSubtitleLanguages)
        if (preferredSub !== null) {
            const currentSub = state.subtitleTracks.find(t => t.selected)
            if (currentSub?.id !== preferredSub) {
                log.info(`Auto-selecting preferred subtitle track: ${preferredSub}`)
                runNativeCommand("setSubtitleTrack", nativeRef => nativeRef.setSubtitleTrack(preferredSub))
            }
        }
    }, [runNativeCommand, state.audioTracks, state.subtitleTracks])

    // ---------------------------------------------------------------------------
    // Control callbacks
    // ---------------------------------------------------------------------------
    const play = React.useCallback(() => {
        runNativeCommand("play", ref => ref.play())
    }, [runNativeCommand])

    const pause = React.useCallback(() => {
        runNativeCommand("pause", ref => ref.pause())
    }, [runNativeCommand])

    const togglePlayPause = React.useCallback(() => {
        if (state.paused) {
            runNativeCommand("play", ref => ref.play())
        } else {
            runNativeCommand("pause", ref => ref.pause())
        }
    }, [runNativeCommand, state.paused])

    const seekTo = React.useCallback((sec: number) => {
        const maxDuration = durationRef.current > 0 ? durationRef.current : Number.POSITIVE_INFINITY
        const target = Math.max(0, Math.min(sec, maxDuration))
        runNativeCommand("seekTo", ref => ref.seekTo(target))
    }, [runNativeCommand])

    const seekRelative = React.useCallback((deltaSec: number) => {
        runNativeCommand("seekBy", ref => ref.seekBy(deltaSec))
    }, [runNativeCommand])

    const setVideoZoom = React.useCallback((scale: number) => {
        runNativeCommand("setVideoZoom", ref => ref.setVideoZoom(scale))
    }, [runNativeCommand])

    const setZoomedToFill = React.useCallback((zoomed: boolean) => {
        runNativeCommand("setZoomedToFill", ref => ref.setZoomedToFill(zoomed))
    }, [runNativeCommand])

    const setAudioTrack = React.useCallback((trackId: number) => {
        runNativeCommand("setAudioTrack", ref => ref.setAudioTrack(trackId))
    }, [runNativeCommand])

    const setSubtitleTrack = React.useCallback((trackId: number) => {
        const visible = trackId >= 0
        if (trackId < 0) {
            runNativeCommand("disableSubtitles", ref => ref.disableSubtitles())
        } else {
            runNativeCommand("setSubtitleTrack", ref => ref.setSubtitleTrack(trackId))
        }
        runNativeCommand("setSubtitleVisibility", ref => ref.setSubtitleVisibility(visible))
        setPlayerPreferences({ showSubtitles: visible })
    }, [runNativeCommand])

    const stop = React.useCallback(() => {
        const ref = viewRef.current
        if (ref) {
            void ref.stopPictureInPicture().catch(() => undefined)
            void ref.pause().catch(() => undefined)
        }

        durationRef.current = 0
        hasAppliedDefaultTracks.current = false
        hasAppliedPrefs.current = false
        if (bufferingTimerRef.current !== null) {
            clearTimeout(bufferingTimerRef.current)
            bufferingTimerRef.current = null
        }
        setState(INITIAL_STATE)
        loadedSourceId.current = null
    }, [])

    const setSpeed = React.useCallback((speed: number) => {
        runNativeCommand("setSpeed", ref => ref.setSpeed(speed))
    }, [runNativeCommand])

    const setSubtitleDelay = React.useCallback((delaySec: number) => {
        runNativeCommand("setSubtitleDelay", ref => ref.setSubtitleDelay(delaySec))
    }, [runNativeCommand])

    const setAudioDelay = React.useCallback((delaySec: number) => {
        runNativeCommand("setAudioDelay", ref => ref.setAudioDelay(delaySec))
    }, [runNativeCommand])

    const setSubtitleFontSize = React.useCallback((size: number) => {
        runNativeCommand("setSubtitleFontSize", ref => ref.setSubtitleFontSize(size))
    }, [runNativeCommand])

    const setSubtitleVisibility = React.useCallback((visible: boolean) => {
        runNativeCommand("setSubtitleVisibility", ref => ref.setSubtitleVisibility(visible))
    }, [runNativeCommand])

    const setSubtitlePosition = React.useCallback((positionPercent: number) => {
        runNativeCommand("setSubtitlePosition", ref => ref.setSubtitlePosition(positionPercent))
    }, [runNativeCommand])

    const setSubtitleScale = React.useCallback((scale: number) => {
        runNativeCommand("setSubtitleScale", ref => ref.setSubtitleScale(scale))
    }, [runNativeCommand])

    const setSubtitleMarginY = React.useCallback((margin: number) => {
        runNativeCommand("setSubtitleMarginY", ref => ref.setSubtitleMarginY(margin))
    }, [runNativeCommand])

    const setSubtitleAlignX = React.useCallback((alignment: SubtitleHorizontalAlignment) => {
        runNativeCommand("setSubtitleAlignX", ref => ref.setSubtitleAlignX(alignment))
    }, [runNativeCommand])

    const setSubtitleAlignY = React.useCallback((alignment: SubtitleVerticalAlignment) => {
        runNativeCommand("setSubtitleAlignY", ref => ref.setSubtitleAlignY(alignment))
    }, [runNativeCommand])

    const startPiP = React.useCallback(() => {
        const ref = viewRef.current
        if (!ref) return

        setState(s => s.isPiPActive ? s : { ...s, isPiPActive: true })
        void ref.startPictureInPicture().catch(error => {
            handleNativeCommandError("startPictureInPicture", error)
            setState(s => s.isPiPActive ? { ...s, isPiPActive: false } : s)
        })
    }, [handleNativeCommandError])

    const stopPiP = React.useCallback(() => {
        runNativeCommand("stopPictureInPicture", ref => ref.stopPictureInPicture())
    }, [runNativeCommand])

    const addSubtitleFile = React.useCallback(async (url: string, select: boolean) => {
        const ref = viewRef.current
        if (!ref) return

        try {
            await ref.addSubtitleFile(url, select)
            // re-fetch tracks so the UI reflects the newly added subtitle
            await onNativeTracksReady()
        }
        catch (error) {
            handleNativeCommandError("addSubtitleFile", error)
        }
    }, [handleNativeCommandError, onNativeTracksReady])

    return {
        // view integration
        viewRef,
        videoSource,
        nowPlayingMetadata,
        onNativeLoad,
        onNativeProgress,
        onNativePlaybackStateChange,
        onNativeError,
        onNativeTracksReady,

        // existing interface
        source,
        state,
        loadingMessage,
        error,

        play,
        pause,
        togglePlayPause,
        seekTo,
        setVideoZoom,
        setZoomedToFill,
        seekRelative,
        setAudioTrack,
        setSubtitleTrack,
        stop,
        setSpeed,
        setSubtitleDelay,
        setAudioDelay,
        setSubtitleFontSize,
        setSubtitleVisibility,
        setSubtitlePosition,
        setSubtitleScale,
        setSubtitleMarginY,
        setSubtitleAlignX,
        setSubtitleAlignY,
        startPiP,
        stopPiP,
        addSubtitleFile,
    }
}

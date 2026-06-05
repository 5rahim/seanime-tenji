import { getClientIdentity } from "@/api/client/client-identity"
import { useUpdateAnimeEntryProgress } from "@/api/hooks/anime_entries.hooks"
import { useUpdateContinuityWatchHistoryItem } from "@/api/hooks/continuity.hooks"
import { usePlaybackCancelManualTracking, usePlaybackStartManualTracking } from "@/api/hooks/playback_manager.hooks"
import { useIsServerConnected } from "@/lib/offline"
import { logger } from "@/lib/utils/logger"
import React from "react"
import { AppState, type AppStateStatus } from "react-native"
import type { MobilePlaybackSource, PlayerState } from "./types"

const log = logger("continuity-sync")

const CONTINUITY_UPDATE_INTERVAL_MS = 15_000 // every 15s
const COMPLETION_THRESHOLD = 0.85 // 85% watched = completed

export function useContinuitySync(
    source: MobilePlaybackSource | null,
    playerState: PlayerState,
) {
    const isConnected = useIsServerConnected()
    const { mutate: updateContinuity } = useUpdateContinuityWatchHistoryItem()
    const { mutate: updateAnimeProgress } = useUpdateAnimeEntryProgress(source?.mediaId, source?.episodeNumber ?? 0, false)
    const { mutate: startManualTracking } = usePlaybackStartManualTracking()
    const { mutate: cancelManualTracking } = usePlaybackCancelManualTracking({})

    const hasSyncedCompletion = React.useRef(false)

    React.useEffect(() => {
        if (!isConnected || !source || source.serverStreamType || source.mediaId <= 0 || source.episodeNumber <= 0) return

        startManualTracking({
            mediaId: source.mediaId,
            episodeNumber: source.episodeNumber,
            clientId: getClientIdentity().clientId,
        })

        return () => {
            cancelManualTracking()
        }
    }, [cancelManualTracking, isConnected, source?.episodeNumber, source?.id, source?.mediaId, source?.serverStreamType, startManualTracking])

    const getPayload = React.useCallback(() => {
        if (!source) return null
        return {
            options: {
                currentTime: playerState.currentTime,
                duration: playerState.duration,
                mediaId: source.mediaId,
                episodeNumber: source.episodeNumber,
                filepath: source.localFile?.path,
                kind: source.continuityKind,
            },
        }
    }, [source, playerState.currentTime, playerState.duration])

    // Flush continuity to server
    const flushContinuity = React.useCallback(() => {
        if (!isConnected) return

        const payload = getPayload()
        if (!payload || playerState.duration <= 0) return
        updateContinuity(payload)
    }, [getPayload, isConnected, playerState.duration, updateContinuity])

    // Periodic continuity updates while playing
    React.useEffect(() => {
        if (!source || playerState.paused || playerState.duration <= 0) return

        const interval = setInterval(() => {
            flushContinuity()
        }, CONTINUITY_UPDATE_INTERVAL_MS)

        return () => clearInterval(interval)
    }, [source, playerState.paused, playerState.duration, flushContinuity])

    // Flush on pause
    React.useEffect(() => {
        if (playerState.paused && source && playerState.duration > 0) {
            flushContinuity()
        }
    }, [playerState.paused, source, playerState.duration, flushContinuity])

    // Flush on app background
    React.useEffect(() => {
        const handleAppState = (nextState: AppStateStatus) => {
            if (nextState === "background" || nextState === "inactive") {
                flushContinuity()
            }
        }

        const sub = AppState.addEventListener("change", handleAppState)
        return () => sub.remove()
    }, [flushContinuity])

    // Flush on unmount
    React.useEffect(() => {
        return () => {
            flushContinuity()
        }
    }, [])

    // Detect completion
    React.useEffect(() => {
        if (!source || playerState.duration <= 0 || hasSyncedCompletion.current) return

        const ratio = playerState.currentTime / playerState.duration

        if (ratio >= COMPLETION_THRESHOLD || playerState.eofReached) {
            hasSyncedCompletion.current = true
            log.info(`Episode completed (${Math.round(ratio * 100)}%), syncing progress`)

            updateAnimeProgress({
                mediaId: source.mediaId,
                malId: source.media?.idMal,
                episodeNumber: source.episodeNumber,
                totalEpisodes: source.media?.episodes || 0,
            })
        }
    }, [source, playerState.currentTime, playerState.duration, playerState.eofReached, updateAnimeProgress])

    // Reset completion flag when source changes
    React.useEffect(() => {
        hasSyncedCompletion.current = false
    }, [source?.id])

    return {
        flushContinuity,
    }
}

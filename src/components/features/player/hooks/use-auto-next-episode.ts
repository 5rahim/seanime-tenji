import React from "react"
import { AUTO_NEXT_COUNTDOWN_SECONDS, AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD, AUTO_NEXT_TRIGGER_REMAINING_SECONDS } from "../constants"

interface UseAutoNextEpisodeParams {
    sourceId: string | undefined
    canAutoAdvance: boolean
    isPiPActive: boolean
    autoNextEnabled: boolean
    paused: boolean
    currentTime: number
    duration: number
    remainingTime: number
    eofReached: boolean
    playNextEpisode: () => void
}

/**
 * Manages auto-next episode countdown logic.
 */
export function useAutoNextEpisode(params: UseAutoNextEpisodeParams) {
    const {
        sourceId, canAutoAdvance, isPiPActive, autoNextEnabled,
        paused, currentTime, duration, remainingTime, eofReached, playNextEpisode,
    } = params

    const [autoNextCountdown, setAutoNextCountdown] = React.useState<number | null>(null)
    const autoNextTriggeredRef = React.useRef<string | null>(null)
    const autoNextDismissedRef = React.useRef<string | null>(null)

    const cancelAutoNext = () => {
        if (sourceId) autoNextDismissedRef.current = sourceId
        setAutoNextCountdown(null)
    }

    // reset on source change
    React.useEffect(() => {
        setAutoNextCountdown(null)
        autoNextTriggeredRef.current = null
        autoNextDismissedRef.current = null
    }, [sourceId])

    // start countdown
    React.useEffect(() => {
        // mpv runs with keep-open, so it reports paused once the file ends; don't treat that as a user pause.
        if (!sourceId || !autoNextEnabled || !canAutoAdvance || (paused && !eofReached) || isPiPActive) {
            setAutoNextCountdown(null)
            return
        }
        if (autoNextTriggeredRef.current === sourceId || autoNextDismissedRef.current === sourceId) return

        const progressRatio = duration > 0 ? currentTime / duration : 0
        const isNearEnd = duration > 0
            && currentTime > 0
            && progressRatio >= AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD
            && remainingTime <= AUTO_NEXT_TRIGGER_REMAINING_SECONDS
        const shouldStart = isNearEnd || (eofReached && progressRatio >= AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD)
        if (!shouldStart) {
            setAutoNextCountdown(null)
            return
        }

        setAutoNextCountdown(current => current ?? AUTO_NEXT_COUNTDOWN_SECONDS)
    }, [canAutoAdvance, isPiPActive, autoNextEnabled, remainingTime, sourceId, duration, eofReached, paused, currentTime])

    // tick down
    React.useEffect(() => {
        if (!sourceId || autoNextCountdown === null) return
        if (autoNextTriggeredRef.current === sourceId) return

        if (autoNextCountdown <= 0) {
            autoNextTriggeredRef.current = sourceId
            setAutoNextCountdown(null)
            playNextEpisode()
            return
        }

        const timeout = setTimeout(() => {
            setAutoNextCountdown(current => current === null ? null : current - 1)
        }, 1000)

        return () => clearTimeout(timeout)
    }, [autoNextCountdown, playNextEpisode, sourceId])

    const triggerAutoNext = () => {
        if (sourceId) autoNextTriggeredRef.current = sourceId
        setAutoNextCountdown(null)
        playNextEpisode()
    }

    return {
        autoNextCountdown,
        cancelAutoNext,
        triggerAutoNext,
        autoNextTriggeredRef,
    }
}

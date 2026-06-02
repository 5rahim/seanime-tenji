import type { PlayerChapter, PlayerStatus } from "@/lib/player"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { toast } from "@/lib/utils/toast"
import React from "react"

interface SkipInterval {
    startTime: number
    endTime: number
}

interface SkipData {
    op: { interval: SkipInterval } | null
    ed: { interval: SkipInterval } | null
}

function getChapterType(name: string | null | undefined) {
    if (!name) return null
    const normalized = name.trim().toLowerCase()
    if (/opening$|^opening\s|^op$/i.test(normalized)) return "op"
    if (/ending$|^ending\s|^ed$|^credits/i.test(normalized)) return "ed"
    return null
}

function getChaptersSkipData(chapters: PlayerChapter[], duration: number): SkipData {
    let op: { interval: SkipInterval } | null = null
    let ed: { interval: SkipInterval } | null = null

    if (!chapters || chapters.length === 0 || duration <= 0) {
        return { op, ed }
    }

    const sorted = [...chapters].sort((a, b) => a.start - b.start)

    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i]
        const type = getChapterType(c.title)
        if (!type) continue

        const start = c.start
        const nextStart = i < sorted.length - 1 ? sorted[i + 1].start : duration
        const end = Math.max(start, nextStart)

        if (type === "op" && !op) {
            op = { interval: { startTime: start, endTime: end } }
        } else if (type === "ed" && !ed) {
            ed = { interval: { startTime: start, endTime: end } }
        }
    }

    return { op, ed }
}

interface UseSkipDataProps {
    source: MobilePlaybackSource | null
    chapters: PlayerChapter[]
    duration: number
    currentTime: number
    status: PlayerStatus
    autoSkipOpEd: boolean
    playerSeekTo: (time: number) => void
}

export function useSkipData({
    source,
    chapters,
    duration,
    currentTime,
    status,
    autoSkipOpEd,
    playerSeekTo,
}: UseSkipDataProps) {
    const [skipData, setSkipData] = React.useState<SkipData>({ op: null, ed: null })
    const lastAutoSkippedRef = React.useRef<string | null>(null)

    React.useEffect(() => {
        lastAutoSkippedRef.current = null
    }, [source?.id])

    React.useEffect(() => {
        const chapterSkip = getChaptersSkipData(chapters, duration)

        if (chapterSkip.op && chapterSkip.ed) {
            setSkipData(chapterSkip)
            return
        }

        const malId = source?.media?.idMal
        const epNum = source?.episodeNumber

        if (!malId || !epNum) {
            setSkipData(chapterSkip)
            return
        }

        let active = true
        fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${epNum}?types[]=ed&types[]=mixed-ed&types[]=mixed-op&types[]=op&types[]=recap&episodeLength=`)
            .then(res => res.json())
            .then(data => {
                if (!active) return
                if (data && data.found && data.results) {
                    const aniOp = data.results.find((r: any) => r.skipType === "op" || r.skipType === "mixed-op")
                    const aniEd = data.results.find((r: any) => r.skipType === "ed" || r.skipType === "mixed-ed")

                    setSkipData({
                        op: chapterSkip.op || (aniOp ? { interval: { startTime: aniOp.interval.startTime, endTime: aniOp.interval.endTime } } : null),
                        ed: chapterSkip.ed || (aniEd ? { interval: { startTime: aniEd.interval.startTime, endTime: aniEd.interval.endTime } } : null),
                    })
                } else {
                    setSkipData(chapterSkip)
                }
            })
            .catch(() => {
                if (active) setSkipData(chapterSkip)
            })

        return () => {
            active = false
        }
    }, [source?.media?.idMal, source?.episodeNumber, chapters, duration])

    React.useEffect(() => {
        if (!autoSkipOpEd) return
        if (status !== "ready" && status !== "buffering") return

        if (skipData.op) {
            const { startTime, endTime } = skipData.op.interval
            if (currentTime >= startTime && currentTime < endTime - 1.5) {
                const skipId = `op-${source?.id}-${startTime}`
                if (lastAutoSkippedRef.current !== skipId) {
                    lastAutoSkippedRef.current = skipId
                    playerSeekTo(endTime)
                    toast.info("Skipped opening intro")
                }
            }
        }

        if (skipData.ed) {
            const { startTime, endTime } = skipData.ed.interval
            if (currentTime >= startTime && currentTime < endTime - 1.5) {
                const skipId = `ed-${source?.id}-${startTime}`
                if (lastAutoSkippedRef.current !== skipId) {
                    lastAutoSkippedRef.current = skipId
                    playerSeekTo(endTime)
                    toast.info("Skipped ending outro")
                }
            }
        }
    }, [currentTime, status, skipData, autoSkipOpEd, source?.id, playerSeekTo])

    const showSkipIntro = Boolean(
        skipData.op &&
        currentTime >= skipData.op.interval.startTime &&
        currentTime <= skipData.op.interval.startTime + 12 &&
        !autoSkipOpEd,
    )

    const showSkipOutro = Boolean(
        skipData.ed &&
        currentTime >= skipData.ed.interval.startTime &&
        currentTime <= skipData.ed.interval.startTime + 12 &&
        !autoSkipOpEd,
    )

    return {
        skipData,
        showSkipIntro,
        showSkipOutro,
    }
}

import { logger } from "@/lib/utils/logger"
import * as React from "react"
import { runAfterInteractions } from "@/lib/run-after-interactions"

const log = logger("screen-profiler")

function getNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }

    return Date.now()
}

export function useDevScreenProfiler(label: string, primaryContentReady: boolean = true) {
    const mountTimeRef = React.useRef(0)
    const didLogReadyRef = React.useRef(false)

    React.useEffect(() => {
        if (!__DEV__) return

        const start = getNow()
        mountTimeRef.current = start
        didLogReadyRef.current = false

        const task = runAfterInteractions(() => {
            log.info(`${label} interactions settled in ${Math.round(getNow() - start)}ms`)
        })

        return () => {
            task.cancel()
        }
    }, [label])

    React.useEffect(() => {
        if (!__DEV__ || !primaryContentReady || didLogReadyRef.current || mountTimeRef.current === 0) return

        didLogReadyRef.current = true
        log.info(`${label} primary content ready in ${Math.round(getNow() - mountTimeRef.current)}ms`)
    }, [label, primaryContentReady])
}
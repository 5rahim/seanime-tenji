import { useServerUrl } from "@/atoms/server.atoms"
import { handleAnimeDownloadAppStateChange, resumeStalledAnimeDownloads } from "@/lib/downloads/download-manager"
import { getActiveDownloads } from "@/lib/downloads/download-store"
import { handleMangaDownloadAppStateChange, resumeStalledMangaDownloads } from "@/lib/downloads/manga-download-manager"
import { getActiveMangaDownloads } from "@/lib/downloads/manga-download-store"
import { useServerConnectionState } from "@/lib/offline"
import { logger } from "@/lib/utils/logger"
import { useCallback, useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"

const log = logger("download-queue-resume")
const RESUME_MIN_GAP_MS = 5_000

export function useDownloadQueueResumeService() {
    const serverUrl = useServerUrl()
    const connectionState = useServerConnectionState()
    const appStateRef = useRef<AppStateStatus>(AppState.currentState)
    const resumeInFlightRef = useRef(false)
    const lastResumeAtRef = useRef(0)

    const resumeQueues = useCallback(async (reason: "initial" | "reconnect" | "foreground") => {
        if (connectionState !== "connected" || !serverUrl) return
        if (appStateRef.current !== "active") return
        if (resumeInFlightRef.current) return

        const now = Date.now()
        if (now - lastResumeAtRef.current < RESUME_MIN_GAP_MS) return

        const stalledAnimeDownloads = getActiveDownloads()
        const stalledMangaDownloads = getActiveMangaDownloads()

        if (stalledAnimeDownloads.length === 0 && stalledMangaDownloads.length === 0) {
            return
        }

        resumeInFlightRef.current = true
        log.info(
            `Resuming ${stalledAnimeDownloads.length} anime and ${stalledMangaDownloads.length} manga downloads (${reason})`,
        )

        try {
            await Promise.all([
                resumeStalledAnimeDownloads(serverUrl, stalledAnimeDownloads),
                Promise.resolve(resumeStalledMangaDownloads(serverUrl, stalledMangaDownloads)),
            ])
            lastResumeAtRef.current = Date.now()
            log.success("Download queue resume finished", { reason })
        }
        catch (error) {
            log.error("Download queue resume failed", { reason }, error)
        }
        finally {
            resumeInFlightRef.current = false
        }
    }, [connectionState, serverUrl])

    useEffect(() => {
        if (connectionState !== "connected" || !serverUrl || appStateRef.current !== "active") return

        void resumeQueues(lastResumeAtRef.current === 0 ? "initial" : "reconnect")
    }, [connectionState, resumeQueues, serverUrl])

    useEffect(() => {
        const subscription = AppState.addEventListener("change", nextState => {
            const previousState = appStateRef.current
            appStateRef.current = nextState

            void handleAnimeDownloadAppStateChange(nextState)
            handleMangaDownloadAppStateChange(nextState)

            const becameActive = (previousState === "inactive" || previousState === "background") && nextState === "active"
            if (becameActive) {
                void resumeQueues("foreground")
            }
        })

        return () => subscription.remove()
    }, [resumeQueues])
}

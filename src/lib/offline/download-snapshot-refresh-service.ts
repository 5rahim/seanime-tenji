import { buildSeaQuery } from "@/api/client/requests"
import { getServerBaseUrl } from "@/api/client/server-url"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Anime_Entry, Manga_Entry } from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { getAllDownloadedAnime, getAllDownloadedManga } from "@/lib/downloads"
import { syncLocalServerFilesToDownloads } from "@/lib/downloads/download-manager"
import { saveAnimeDownloadEntrySnapshot, saveMangaDownloadEntrySnapshot } from "@/lib/offline/download-entry-snapshot-store"
import { logger } from "@/lib/utils/logger"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"
import { useServerConnectionState } from "./use-offline"

const SNAPSHOT_REFRESH_INTERVAL_MS = 10 * 60 * 1000
const SNAPSHOT_REFRESH_MIN_GAP_MS = 45 * 1000

const log = logger("download-snapshot-refresh")

async function fetchAnimeEntrySnapshot(serverUrl: string, mediaId: number): Promise<Anime_Entry | undefined> {
    return buildSeaQuery<Anime_Entry>({
        serverUrl,
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.endpoint.replace("{id}", String(mediaId)),
        method: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.methods[0],
        muteError: true,
    })
}

async function fetchMangaEntrySnapshot(serverUrl: string, mediaId: number): Promise<Manga_Entry | undefined> {
    return buildSeaQuery<Manga_Entry>({
        serverUrl,
        endpoint: API_ENDPOINTS.MANGA.GetMangaEntry.endpoint.replace("{id}", String(mediaId)),
        method: API_ENDPOINTS.MANGA.GetMangaEntry.methods[0],
        muteError: true,
    })
}

/**
 * Keeps download entry snapshots fresh while the app is active and connected.
 *
 * This prevents sudden connectivity loss from falling back to stale metadata when
 * the user opens downloaded anime or manga entries offline.
 */
export function useDownloadSnapshotRefreshService() {
    const serverUrl = useServerUrl()
    const connectionState = useServerConnectionState()
    const queryClient = useQueryClient()
    const appStateRef = useRef<AppStateStatus>(AppState.currentState)
    const refreshInFlightRef = useRef(false)
    const lastRefreshAtRef = useRef(0)

    const refreshSnapshots = useCallback(async (reason: "interval" | "foreground" | "reconnect" | "initial") => {
        if (connectionState !== "connected" || !serverUrl) return
        if (appStateRef.current !== "active") return
        if (refreshInFlightRef.current) return

        const now = Date.now()
        if (now - lastRefreshAtRef.current < SNAPSHOT_REFRESH_MIN_GAP_MS) return

        refreshInFlightRef.current = true
        try {
            await syncLocalServerFilesToDownloads(serverUrl)
        }
        catch (e) {
            log.warning("Local server sync failed in snapshot refresh service", e)
        }

        const downloadedAnime = getAllDownloadedAnime()
        const downloadedManga = getAllDownloadedManga()
        if (downloadedAnime.length === 0 && downloadedManga.length === 0) {
            refreshInFlightRef.current = false
            return
        }

        const baseUrl = getServerBaseUrl(serverUrl)
        log.info(`Refreshing ${downloadedAnime.length} anime and ${downloadedManga.length} manga snapshots (${reason}) from ${baseUrl}`)

        try {
            for (const anime of downloadedAnime) {
                try {
                    const entry = await queryClient.fetchQuery({
                        queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(anime.mediaId)],
                        queryFn: () => fetchAnimeEntrySnapshot(serverUrl, anime.mediaId),
                        staleTime: 0,
                    })

                    if (entry?.media) {
                        saveAnimeDownloadEntrySnapshot(entry)
                    }
                }
                catch {
                    log.warning(`Failed refreshing anime snapshot ${anime.mediaId}`)
                }
            }

            for (const manga of downloadedManga) {
                try {
                    const entry = await queryClient.fetchQuery({
                        queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key, String(manga.mediaId)],
                        queryFn: () => fetchMangaEntrySnapshot(serverUrl, manga.mediaId),
                        staleTime: 0,
                    })

                    if (entry?.media) {
                        saveMangaDownloadEntrySnapshot(entry)
                    }
                }
                catch {
                    log.warning(`Failed refreshing manga snapshot ${manga.mediaId}`)
                }
            }

            lastRefreshAtRef.current = Date.now()
        }
        finally {
            refreshInFlightRef.current = false
        }
    }, [connectionState, queryClient, serverUrl])

    useEffect(() => {
        if (connectionState !== "connected" || !serverUrl || appStateRef.current !== "active") return

        void refreshSnapshots(lastRefreshAtRef.current === 0 ? "initial" : "reconnect")

        const interval = setInterval(() => {
            void refreshSnapshots("interval")
        }, SNAPSHOT_REFRESH_INTERVAL_MS)

        return () => clearInterval(interval)
    }, [connectionState, refreshSnapshots, serverUrl])

    useEffect(() => {
        const subscription = AppState.addEventListener("change", nextState => {
            const previousState = appStateRef.current
            appStateRef.current = nextState

            const becameActive = (previousState === "inactive" || previousState === "background") && nextState === "active"
            if (becameActive) {
                void refreshSnapshots("foreground")
            }
        })

        return () => subscription.remove()
    }, [refreshSnapshots])
}

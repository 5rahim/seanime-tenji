import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Anime_Entry, Anime_LibraryCollection, Anime_LocalFile } from "@/api/generated/types"
import { useServerStatus, useServerUrl } from "@/atoms/server.atoms"
import {
    createServerLocalIdentity,
    filterServerLocalAnimeEntry,
    parseServerLocalAnimeEntry,
    saveServerLocalAnimeRecords,
    type ServerLocalAnimeRecord,
} from "@/lib/offline/server-local-store"
import { logger } from "@/lib/utils/logger"
import { Image } from "expo-image"
import { useCallback, useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"
import { useServerConnectionState } from "./use-offline"

const REFRESH_INTERVAL_MS = 10 * 60 * 1000
const REFRESH_MIN_GAP_MS = 45 * 1000
const EVENT_DEBOUNCE_MS = 750
const ENTRY_FETCH_CONCURRENCY = 3
const IMAGE_PREFETCH_BATCH_SIZE = 20

const log = logger("server-local-sync")
const syncRequestListeners = new Set<() => void>()

export function requestServerLocalSync(): void {
    for (const listener of syncRequestListeners) {
        listener()
    }
}

function subscribeToSyncRequests(listener: () => void): () => void {
    syncRequestListeners.add(listener)
    return () => syncRequestListeners.delete(listener)
}

function getCollectionMediaIds(collection: Anime_LibraryCollection): Set<number> {
    return new Set(
        (collection.lists ?? [])
            .flatMap(list => list.entries ?? [])
            .filter(entry => !!entry.media && entry.mediaId > 0)
            .map(entry => entry.mediaId),
    )
}

function groupLocalFilePaths(
    localFiles: Anime_LocalFile[],
    collectionMediaIds: ReadonlySet<number>,
): Map<number, Set<string>> {
    const pathsByMediaId = new Map<number, Set<string>>()

    for (const localFile of localFiles) {
        if (
            localFile.ignored
            || localFile.mediaId <= 0
            || !localFile.metadata
            || !collectionMediaIds.has(localFile.mediaId)
        ) {
            continue
        }

        const paths = pathsByMediaId.get(localFile.mediaId) ?? new Set<string>()
        paths.add(localFile.path)
        pathsByMediaId.set(localFile.mediaId, paths)
    }

    return pathsByMediaId
}

function getEntryTitle(entry: Anime_Entry): string {
    return entry.media?.title?.english
        || entry.media?.title?.romaji
        || entry.media?.title?.userPreferred
        || `Anime #${entry.mediaId}`
}

async function fetchEntryRecord(
    serverUrl: string,
    mediaId: number,
    localFilePaths: Set<string>,
): Promise<ServerLocalAnimeRecord | null> {
    const entry = await buildSeaQuery<Anime_Entry>({
        serverUrl,
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.endpoint.replace("{id}", String(mediaId)),
        method: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.methods[0],
        muteError: true,
    })

    if (!entry?.media) return null

    const filteredEntry = filterServerLocalAnimeEntry(entry, localFilePaths)
    const media = filteredEntry.media
    if (!media || !filteredEntry.episodes?.length) return null

    return {
        mediaId,
        title: getEntryTitle(filteredEntry),
        coverImageUrl: media.coverImage?.large ?? media.coverImage?.extraLarge,
        bannerImageUrl: media.bannerImage,
        payload: JSON.stringify(filteredEntry),
        localFilePaths: Array.from(localFilePaths),
        savedAt: Date.now(),
    }
}

async function fetchRecordsC(
    serverUrl: string,
    pathsByMediaId: Map<number, Set<string>>,
): Promise<{ records: ServerLocalAnimeRecord[], failedMediaIds: number[] }> {
    const entries = Array.from(pathsByMediaId.entries())
    const records: ServerLocalAnimeRecord[] = []
    const failedMediaIds: number[] = []
    let cursor = 0

    async function worker() {
        while (cursor < entries.length) {
            const index = cursor
            cursor++
            const [mediaId, paths] = entries[index]

            try {
                const record = await fetchEntryRecord(serverUrl, mediaId, paths)
                if (record) {
                    records.push(record)
                } else {
                    failedMediaIds.push(mediaId)
                }
            }
            catch {
                failedMediaIds.push(mediaId)
            }
        }
    }

    const workerCount = Math.min(ENTRY_FETCH_CONCURRENCY, entries.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    records.sort((left, right) => left.title.localeCompare(right.title))

    return { records, failedMediaIds }
}

function getRecordImageUrls(record: ServerLocalAnimeRecord): string[] {
    const entry = parseServerLocalAnimeEntry(record)
    if (!entry) return []

    const urls = [
        entry.media?.coverImage?.large,
        entry.media?.coverImage?.extraLarge,
        entry.media?.bannerImage,
        ...(entry.episodes ?? []).flatMap(episode => [
            episode.episodeMetadata?.image,
            episode.baseAnime?.bannerImage,
            episode.baseAnime?.coverImage?.large,
        ]),
    ]

    return urls.filter((url): url is string => !!url)
}

async function prefetchRecordImages(records: ServerLocalAnimeRecord[]): Promise<void> {
    const urls = Array.from(new Set(records.flatMap(getRecordImageUrls)))

    for (let index = 0; index < urls.length; index += IMAGE_PREFETCH_BATCH_SIZE) {
        await Image.prefetch(urls.slice(index, index + IMAGE_PREFETCH_BATCH_SIZE), "disk")
    }
}

export function useServerLocalSyncService() {
    const connectionState = useServerConnectionState()
    const serverUrl = useServerUrl()
    const serverStatus = useServerStatus()
    const appStateRef = useRef(AppState.currentState as AppStateStatus)
    const refreshInFlightRef = useRef(false)
    const lastRefreshAtRef = useRef(0)
    const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const refresh = useCallback(async (reason: "initial" | "reconnect" | "foreground" | "interval" | "library-event") => {
        const identity = createServerLocalIdentity(serverUrl, serverStatus)
        if (connectionState !== "connected" || !serverUrl || !identity) return
        if (appStateRef.current !== "active" || refreshInFlightRef.current) return

        const now = Date.now()
        if (reason !== "library-event" && now - lastRefreshAtRef.current < REFRESH_MIN_GAP_MS) return

        refreshInFlightRef.current = true
        log.info(`Refreshing server-local anime (${reason})`)

        try {
            const [collection, localFiles] = await Promise.all([
                buildSeaQuery<Anime_LibraryCollection>({
                    serverUrl,
                    endpoint: API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.endpoint,
                    method: API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.methods[0],
                    muteError: true,
                }),
                buildSeaQuery<Anime_LocalFile[]>({
                    serverUrl,
                    endpoint: API_ENDPOINTS.LOCALFILES.GetLocalFiles.endpoint,
                    method: API_ENDPOINTS.LOCALFILES.GetLocalFiles.methods[0],
                    muteError: true,
                }),
            ])

            if (!collection || !localFiles) {
                log.warning("Library refresh failed; preserving cached server-local entries")
                return
            }

            const collectionMediaIds = getCollectionMediaIds(collection)
            const pathsByMediaId = groupLocalFilePaths(localFiles, collectionMediaIds)
            const { records, failedMediaIds } = await fetchRecordsC(serverUrl, pathsByMediaId)
            const completeRefresh = failedMediaIds.length === 0

            saveServerLocalAnimeRecords(identity, records, completeRefresh)
            lastRefreshAtRef.current = completeRefresh ? Date.now() : 0

            try {
                await prefetchRecordImages(records)
            }
            catch (error) {
                log.warning("Some server-local artwork could not be cached", error)
            }

            if (failedMediaIds.length > 0) {
                log.warning(`Preserved stale records after ${failedMediaIds.length} entry fetch failures`)
            } else {
                log.info(`Cached ${records.length} server-local anime`)
            }
        }
        catch (error) {
            log.warning("Server-local refresh failed", error)
        }
        finally {
            refreshInFlightRef.current = false
        }
    }, [connectionState, serverStatus, serverUrl])

    useEffect(() => {
        if (connectionState !== "connected" || !serverUrl || appStateRef.current !== "active") return

        void refresh(lastRefreshAtRef.current === 0 ? "initial" : "reconnect")

        const interval = setInterval(() => {
            void refresh("interval")
        }, REFRESH_INTERVAL_MS)

        return () => clearInterval(interval)
    }, [connectionState, refresh, serverUrl])

    useEffect(() => {
        const subscription = AppState.addEventListener("change", nextState => {
            const previousState = appStateRef.current
            appStateRef.current = nextState

            if ((previousState === "inactive" || previousState === "background") && nextState === "active") {
                void refresh("foreground")
            }
        })

        return () => subscription.remove()
    }, [refresh])

    useEffect(() => subscribeToSyncRequests(() => {
        if (eventTimerRef.current) clearTimeout(eventTimerRef.current)
        eventTimerRef.current = setTimeout(() => {
            eventTimerRef.current = null
            void refresh("library-event")
        }, EVENT_DEBOUNCE_MS)
    }), [refresh])

    useEffect(() => () => {
        if (eventTimerRef.current) clearTimeout(eventTimerRef.current)
    }, [])
}

import { subscribeWsMessage, type WebsocketMessage } from "@/api/components/websocket-hub"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { requestServerLocalSync } from "@/lib/offline"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"

const WEBSOCKET_EVENTS = {
    // toast events
    ErrorToast: "error-toast",
    SuccessToast: "success-toast",
    InfoToast: "info-toast",
    WarningToast: "warning-toast",
    SettingsChanged: "settings-changed",
    ServerLoggedOutAnilist: "server-logged-out-anilist",
    // collection refresh events
    RefreshedAnilistAnimeCollection: "refreshed-anilist-anime-collection",
    RefreshedAnilistMangaCollection: "refreshed-anilist-manga-collection",
    // library watcher events
    AutoScanCompleted: "auto-scan-completed",
    LibraryWatcherFileAdded: "library-watcher-file-added",
    LibraryWatcherFileRemoved: "library-watcher-file-removed",
    // auto downloader
    AutoDownloaderItemAdded: "auto-downloader-item-added",
    // playback progress events
    PlaybackManagerProgressUpdated: "playback-manager-progress-updated",
    PlaybackManagerProgressVideoCompleted: "playback-manager-progress-video-completed",
    // manga download events
    ChapterDownloadQueueUpdated: "chapter-download-queue-updated",
    // server download events
    ActiveTorrentCountUpdated: "active-torrent-count-updated",
    DebridDownloadProgress: "debrid-download-progress",
    // extension events
    ExtensionsReloaded: "extensions-reloaded",
    ExtensionUpdatesFound: "extension-updates-found",
    PluginUnloaded: "plugin-unloaded",
    PluginLoaded: "plugin-loaded",
    // sync events
    SyncLocalFinished: "sync-local-finished",
    // generic invalidation
    InvalidateQueries: "invalidate-queries",
} as const

type ActiveTorrentCountPayload = {
    downloading: number
    seeding: number
    paused: number
}

const DOWNLOAD_COMPLETION_FOLLOW_UP_MS = 5_000

const animeCollectionRefreshKeys = [
    API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
    API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
    API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetUpcomingEpisodes.key,
    API_ENDPOINTS.MANGA.GetMangaCollection.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key,
    API_ENDPOINTS.MANGA.GetMangaEntry.key,
    API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key,
    API_ENDPOINTS.LIBRARY_EXPLORER.GetLibraryExplorerFileTree.key,
] as const

const mangaCollectionRefreshKeys = [
    API_ENDPOINTS.MANGA.GetAnilistMangaCollection.key,
    API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key,
    API_ENDPOINTS.MANGA.GetMangaCollection.key,
    API_ENDPOINTS.MANGA.GetMangaEntry.key,
] as const

const syncLocalFinishedKeys = [
    API_ENDPOINTS.LOCAL.LocalGetTrackedMediaItems.key,
] as const

const extensionsReloadedKeys = [
    API_ENDPOINTS.EXTENSIONS.ListAnimeTorrentProviderExtensions.key,
    API_ENDPOINTS.EXTENSIONS.ListMangaProviderExtensions.key,
    API_ENDPOINTS.EXTENSIONS.ListOnlinestreamProviderExtensions.key,
    API_ENDPOINTS.EXTENSIONS.ListCustomSourceExtensions.key,
    API_ENDPOINTS.EXTENSIONS.ListExtensionData.key,
    API_ENDPOINTS.EXTENSIONS.GetAllExtensions.key,
    API_ENDPOINTS.EXTENSIONS.GetExtensionUserConfig.key,
    API_ENDPOINTS.EXTENSIONS.GetExtensionUpdateData.key,
    API_ENDPOINTS.EXTENSIONS.ListDevelopmentModeExtensions.key,
] as const

const extensionUpdatesFoundKeys = [
    API_ENDPOINTS.EXTENSIONS.GetExtensionUpdateData.key,
    API_ENDPOINTS.EXTENSIONS.GetAllExtensions.key,
] as const

const pluginUnloadedKeys = [
    API_ENDPOINTS.EXTENSIONS.ListDevelopmentModeExtensions.key,
] as const

const libraryRefreshKeys = [
    API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
    API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
    API_ENDPOINTS.LIBRARY_EXPLORER.GetLibraryExplorerFileTree.key,
    API_ENDPOINTS.LOCALFILES.GetLocalFiles.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
] as const

const autoDownloaderRefreshKeys = [
    API_ENDPOINTS.AUTO_DOWNLOADER.GetAutoDownloaderItems.key,
] as const

const playbackProgressRefreshKeys = [
    API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.key,
] as const

const chapterDownloadRefreshKeys = [
    API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadQueue.key,
    API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadData.key,
    API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadsList.key,
] as const

const torrentClientRefreshKeys = [
    API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.key,
] as const

const debridDownloadRefreshKeys = [
    API_ENDPOINTS.DEBRID.DebridGetTorrents.key,
] as const

const serverLocalInvalidationKeys = [
    API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
    API_ENDPOINTS.LOCALFILES.GetLocalFiles.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
] as const

const settingsChangedKeys = [
    API_ENDPOINTS.SETTINGS.GetSettings.key,
    API_ENDPOINTS.STATUS.GetStatus.key,
    API_ENDPOINTS.MEDIASTREAM.GetMediastreamSettings.key,
    API_ENDPOINTS.TORRENTSTREAM.GetTorrentstreamSettings.key,
    API_ENDPOINTS.DEBRID.GetDebridSettings.key,
] as const

const anilistLogoutKeys = [
    API_ENDPOINTS.STATUS.GetStatus.key,
    API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
    API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key,
    API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
    API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetUpcomingEpisodes.key,
    API_ENDPOINTS.MANGA.GetAnilistMangaCollection.key,
    API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key,
    API_ENDPOINTS.MANGA.GetMangaCollection.key,
] as const

async function invalidateQueryKeys(queryClient: ReturnType<typeof useQueryClient>, queryKeys: readonly string[]) {
    await Promise.all(queryKeys.map(queryKey => queryClient.invalidateQueries({ queryKey: [queryKey] })))
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseActiveTorrentCountPayload(payload: unknown): ActiveTorrentCountPayload | null {
    if (!isObject(payload)) return null

    const { downloading, seeding, paused } = payload
    if (typeof downloading !== "number" || typeof seeding !== "number" || typeof paused !== "number") {
        return null
    }

    return { downloading, seeding, paused }
}

function isDebridDownloadCompletedPayload(payload: unknown): boolean {
    return isObject(payload) && payload.status === "completed"
}

function shouldSyncServerLocalForInvalidation(queryKeys: readonly string[]): boolean {
    return queryKeys.some(queryKey => serverLocalInvalidationKeys.includes(queryKey))
}

export function useWebsocketEventRouter() {
    const queryClient = useQueryClient()
    const activeTorrentCountRef = React.useRef<ActiveTorrentCountPayload | null>(null)
    const downloadCompletionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    React.useEffect(() => {
        const requestDownloadCompletionSync = () => {
            requestServerLocalSync()

            if (downloadCompletionTimerRef.current) {
                clearTimeout(downloadCompletionTimerRef.current)
            }

            downloadCompletionTimerRef.current = setTimeout(() => {
                downloadCompletionTimerRef.current = null
                requestServerLocalSync()
            }, DOWNLOAD_COMPLETION_FOLLOW_UP_MS)
        }

        const handleMessage = async (message: WebsocketMessage) => {
            switch (message.type) {
                case WEBSOCKET_EVENTS.ErrorToast:
                    if (typeof message.payload === "string") {
                        toast.error(message.payload)
                    }
                    return
                case WEBSOCKET_EVENTS.SuccessToast:
                    if (typeof message.payload === "string") {
                        toast.success(message.payload)
                    }
                    return
                case WEBSOCKET_EVENTS.InfoToast:
                    if (typeof message.payload === "string") {
                        toast.info(message.payload)
                    }
                    return
                case WEBSOCKET_EVENTS.WarningToast:
                    if (typeof message.payload === "string") {
                        toast.warning(message.payload)
                    }
                    return
                case WEBSOCKET_EVENTS.SettingsChanged:
                    await invalidateQueryKeys(queryClient, settingsChangedKeys)
                    return
                case WEBSOCKET_EVENTS.ServerLoggedOutAnilist:
                    toast.warning(typeof message.payload === "string"
                        ? message.payload
                        : "Your AniList session ended. Please log in again.")
                    await invalidateQueryKeys(queryClient, anilistLogoutKeys)
                    return
                case WEBSOCKET_EVENTS.RefreshedAnilistAnimeCollection:
                    await invalidateQueryKeys(queryClient, animeCollectionRefreshKeys)
                    requestServerLocalSync()
                    return
                case WEBSOCKET_EVENTS.RefreshedAnilistMangaCollection:
                    await invalidateQueryKeys(queryClient, mangaCollectionRefreshKeys)
                    return
                case WEBSOCKET_EVENTS.ExtensionsReloaded:
                    await invalidateQueryKeys(queryClient, extensionsReloadedKeys)
                    return
                case WEBSOCKET_EVENTS.ExtensionUpdatesFound:
                    await invalidateQueryKeys(queryClient, extensionUpdatesFoundKeys)
                    return
                case WEBSOCKET_EVENTS.PluginUnloaded:
                case WEBSOCKET_EVENTS.PluginLoaded:
                    await invalidateQueryKeys(queryClient, pluginUnloadedKeys)
                    return
                case WEBSOCKET_EVENTS.AutoScanCompleted:
                case WEBSOCKET_EVENTS.LibraryWatcherFileAdded:
                case WEBSOCKET_EVENTS.LibraryWatcherFileRemoved:
                    await invalidateQueryKeys(queryClient, libraryRefreshKeys)
                    requestServerLocalSync()
                    return
                case WEBSOCKET_EVENTS.AutoDownloaderItemAdded:
                    await invalidateQueryKeys(queryClient, autoDownloaderRefreshKeys)
                    return
                case WEBSOCKET_EVENTS.PlaybackManagerProgressUpdated:
                case WEBSOCKET_EVENTS.PlaybackManagerProgressVideoCompleted:
                    await invalidateQueryKeys(queryClient, playbackProgressRefreshKeys)
                    return
                case WEBSOCKET_EVENTS.ChapterDownloadQueueUpdated:
                    await invalidateQueryKeys(queryClient, chapterDownloadRefreshKeys)
                    return
                case WEBSOCKET_EVENTS.ActiveTorrentCountUpdated: {
                    const payload = parseActiveTorrentCountPayload(message.payload)
                    if (!payload) return

                    const previousPayload = activeTorrentCountRef.current
                    activeTorrentCountRef.current = payload

                    if (
                        previousPayload
                        && (payload.downloading < previousPayload.downloading || payload.seeding > previousPayload.seeding)
                    ) {
                        await invalidateQueryKeys(queryClient, torrentClientRefreshKeys)
                        requestDownloadCompletionSync()
                    }
                    return
                }
                case WEBSOCKET_EVENTS.DebridDownloadProgress:
                    if (isDebridDownloadCompletedPayload(message.payload)) {
                        await invalidateQueryKeys(queryClient, debridDownloadRefreshKeys)
                        requestDownloadCompletionSync()
                    }
                    return
                case WEBSOCKET_EVENTS.SyncLocalFinished:
                    await invalidateQueryKeys(queryClient, syncLocalFinishedKeys)
                    requestServerLocalSync()
                    return
                case WEBSOCKET_EVENTS.InvalidateQueries:
                    if (Array.isArray(message.payload) && message.payload.every(item => typeof item === "string")) {
                        await invalidateQueryKeys(queryClient, message.payload)
                        if (shouldSyncServerLocalForInvalidation(message.payload)) {
                            requestServerLocalSync()
                        }
                    } else {
                        logger("websocket-event-router").warning("Received invalidate-queries event with invalid payload", message.payload)
                    }
                    return
                default:
                    return
            }
        }

        const unsubscribe = subscribeWsMessage(handleMessage)

        return () => {
            unsubscribe()
            if (downloadCompletionTimerRef.current) {
                clearTimeout(downloadCompletionTimerRef.current)
                downloadCompletionTimerRef.current = null
            }
        }
    }, [queryClient])
}

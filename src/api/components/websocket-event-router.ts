import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useServerUrl } from "@/atoms/server.atoms"
import { syncLocalServerFilesToDownloads } from "@/lib/downloads/download-manager"
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

type WebsocketServerEvent = {
    type: string
    payload?: unknown
}

const animeCollectionRefreshKeys = [
    API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
    API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
    API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key,
    API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
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

async function invalidateQueryKeys(queryClient: ReturnType<typeof useQueryClient>, queryKeys: readonly string[]) {
    await Promise.all(queryKeys.map(queryKey => queryClient.invalidateQueries({ queryKey: [queryKey] })))
}

function parseWebsocketServerEvent(data: unknown): WebsocketServerEvent | null {
    if (typeof data !== "string") {
        return null
    }

    try {
        const message = JSON.parse(data) as WebsocketServerEvent
        if (typeof message?.type !== "string") {
            return null
        }
        return message
    }
    catch (error) {
        logger("websocket-event-router").warning("Failed to parse WebSocket message", error)
        return null
    }
}

export function useWebsocketEventRouter(socket: WebSocket | null) {
    const queryClient = useQueryClient()
    const serverUrl = useServerUrl()

    React.useEffect(() => {
        if (!socket) {
            return
        }

        const handleMessage = async (event: WebSocketMessageEvent) => {
            const message = parseWebsocketServerEvent(event.data)
            if (!message) {
                return
            }

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
                case WEBSOCKET_EVENTS.RefreshedAnilistAnimeCollection:
                    await invalidateQueryKeys(queryClient, animeCollectionRefreshKeys)
                    if (serverUrl) {
                        syncLocalServerFilesToDownloads(serverUrl)
                    }
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
                    if (serverUrl) {
                        syncLocalServerFilesToDownloads(serverUrl)
                    }
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
                case WEBSOCKET_EVENTS.SyncLocalFinished:
                    await invalidateQueryKeys(queryClient, syncLocalFinishedKeys)
                    return
                case WEBSOCKET_EVENTS.InvalidateQueries:
                    if (Array.isArray(message.payload) && message.payload.every(item => typeof item === "string")) {
                        await invalidateQueryKeys(queryClient, message.payload)
                    } else {
                        logger("websocket-event-router").warning("Received invalidate-queries event with invalid payload", message.payload)
                    }
                    return
                default:
                    return
            }
        }

        socket.addEventListener("message", handleMessage)

        return () => {
            socket.removeEventListener("message", handleMessage)
        }
    }, [queryClient, socket])
}

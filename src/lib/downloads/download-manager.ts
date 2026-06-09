import { buildSeaQuery } from "@/api/client/requests"
import { appendServerHMACToken } from "@/api/client/server-auth"
import { getServerBaseUrl } from "@/api/client/server-url"
import { Anime_Entry, Anime_Episode, Anime_LocalFile, Status } from "@/api/generated/types"
import { getDownloadSettings, getDownloadWorkerCount } from "@/atoms/download-settings.atoms"
import { getStoredJsonValue } from "@/atoms/storage"
import { isManualOfflineModeEnabled } from "@/lib/connection-state"
import {
    batchDownloadStoreWrites,
    clearAllAnimeDownloadRecords,
    type DownloadedAnimeInfo,
    type DownloadedEpisode,
    type DownloadStatus,
    getAnimeInfo,
    getDownloadedEpisode,
    getDownloadedEpisodesForMedia,
    getDownloadEpisodeId,
    markDownloadCompleted,
    markDownloadFailed,
    markDownloadPending,
    readGlobalIndex,
    removeAllAnimeDownloadsForMedia,
    removeDownloadedEpisode,
    saveAnimeInfo,
    saveDownloadedEpisode,
    updateAnimeInfoDownloadCount,
    updateDownloadProgress,
} from "@/lib/downloads/download-store"
import {
    attachManagedNativeDownload,
    cancelManagedNativeDownload,
    getManagedNativeDownload,
    isNativeDownloadCancelledError,
    type ManagedNativeDownloadOptions,
    startManagedNativeDownload,
} from "@/lib/downloads/native-download"
import { saveAnimeDownloadEntrySnapshot } from "@/lib/offline/download-entry-snapshot-store"
import { logger } from "@/lib/utils/logger"
import { Directory, File, Paths } from "expo-file-system"
import { deleteAsync } from "expo-file-system/legacy"
import { AppState, type AppStateStatus } from "react-native"

const log = logger("download-manager")
const DOWNLOAD_PROGRESS_MIN_DELTA = 0.01
const DOWNLOAD_PROGRESS_MIN_INTERVAL_MS = 250

/**
 * Downloads directory, under the app's documents directory.
 * Organized as: {document}/downloads/{mediaId}/ep-{episodeNumber}.{ext}
 */
function getDownloadsDir(): Directory {
    return new Directory(Paths.document, "downloads")
}

function getMediaDir(mediaId: number): Directory {
    return new Directory(getDownloadsDir(), String(mediaId))
}

function getEpisodeFileName(episodeId: string, extension: string = "mp4"): string {
    // sanitize the episodeId for filesystem safety
    const safe = episodeId.replace(/[^a-zA-Z0-9_-]/g, "_")
    return `ep-${safe}.${extension}`
}

function getExtension(filename: string): string {
    const match = filename.match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1].toLowerCase() : "mp4"
}

function ensureDir(dir: Directory): void {
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true })
    }
}

////////////////////////// Active download tracking

type ActiveDownload = {
    mediaId: number
    episodeId: string
    cancelled: boolean
    completed: boolean
    pausedForAppState: boolean
    downloadId: string
    lastProgressAt: number
    lastProgressValue: number
}

type AnimeDownloadSource = {
    serverUrl: string
    animeInfo: DownloadedAnimeInfo
    mediaId: number
    episodeId: string
    episodeNumber: number
    serverFilePath: string
    displayTitle: string
    episodeTitle: string
    type: DownloadedEpisode["type"]
    thumbnailUrl?: string
    extensionHint?: string
}

type QueuedAnimeDownload = AnimeDownloadSource & {
    resolve: () => void
}

type EnqueueAnimeDownloadOptions = {
    allowExistingActiveState?: boolean
}

type SaveEpisodeDownloadRecordOptions = {
    startedAt?: number
    progress?: number
    fileSize?: number
    isLocalServerFile?: boolean
}

const activeDownloads = new Map<string, ActiveDownload>()
const queuedDownloads: QueuedAnimeDownload[] = []
let currentAppState: AppStateStatus = AppState.currentState

function dlKey(mediaId: number, episodeId: string): string {
    return `${mediaId}:${episodeId}`
}

function hasQueuedAnimeDownload(mediaId: number, episodeId: string): boolean {
    return queuedDownloads.some(item => item.mediaId === mediaId && item.episodeId === episodeId)
}

function shouldPauseAnimeDownloadsForAppState(nextState: AppStateStatus = currentAppState): boolean {
    if (nextState === "active") return false

    return !getDownloadSettings().backgroundDownloading
}

function isBackgroundInterruptionError(message: string): boolean {
    const normalized = message.toLowerCase()

    return normalized.includes("software caused connection abort")
        || normalized.includes("connection abort")
        || normalized.includes("connection reset")
        || normalized.includes("network request failed")
        || normalized.includes("stream was reset")
        || normalized.includes("broken pipe")
}

function getAnimeLibraryInfo(entry: Anime_Entry): DownloadedAnimeInfo {
    return {
        mediaId: entry.mediaId,
        title: entry.media?.title?.english
            || entry.media?.title?.romaji
            || entry.media?.title?.userPreferred
            || `Anime #${entry.mediaId}`,
        coverImageUrl: entry.media?.coverImage?.large ?? entry.media?.coverImage?.large,
        bannerImageUrl: entry.media?.bannerImage,
        totalEpisodes: entry.media?.episodes,
        downloadedCount: 0,
    }
}

function buildEpisodeDownloadSource(
    serverUrl: string,
    entry: Anime_Entry,
    episode: Anime_Episode,
): AnimeDownloadSource {
    return {
        serverUrl,
        animeInfo: getAnimeLibraryInfo(entry),
        mediaId: entry.mediaId,
        episodeId: getDownloadEpisodeId(episode.aniDBEpisode, episode.type, episode.episodeNumber, episode.localFile?.path),
        episodeNumber: episode.episodeNumber,
        serverFilePath: episode.localFile?.path ?? "",
        displayTitle: episode.displayTitle,
        episodeTitle: episode.episodeTitle,
        type: episode.type as DownloadedEpisode["type"],
        thumbnailUrl: episode.episodeMetadata?.image || episode.baseAnime?.bannerImage,
        extensionHint: episode.localFile?.name,
    }
}

function buildRetryEpisodeSource(serverUrl: string, episode: DownloadedEpisode): AnimeDownloadSource {
    return {
        serverUrl,
        animeInfo: getAnimeInfo(episode.mediaId) ?? {
            mediaId: episode.mediaId,
            title: `Anime #${episode.mediaId}`,
            downloadedCount: 0,
        },
        mediaId: episode.mediaId,
        episodeId: episode.aniDBEpisode,
        episodeNumber: episode.episodeNumber,
        serverFilePath: episode.serverFilePath,
        displayTitle: episode.displayTitle,
        episodeTitle: episode.episodeTitle,
        type: episode.type,
        thumbnailUrl: episode.thumbnailUrl,
        extensionHint: episode.localFilePath || episode.serverFilePath,
    }
}

function getEpisodeDestinationFile(source: AnimeDownloadSource): File {
    const extension = getExtension(source.extensionHint ?? source.serverFilePath)
    const mediaDir = getMediaDir(source.mediaId)
    ensureDir(mediaDir)
    return new File(mediaDir, getEpisodeFileName(source.episodeId, extension))
}

function saveEpisodeDownloadRecord(
    source: AnimeDownloadSource,
    status: DownloadStatus,
    localFilePath: string,
    options?: SaveEpisodeDownloadRecordOptions,
): void {
    batchDownloadStoreWrites(() => {
        saveAnimeInfo(source.animeInfo)
        saveDownloadedEpisode({
            mediaId: source.mediaId,
            episodeNumber: source.episodeNumber,
            aniDBEpisode: source.episodeId,
            localFilePath,
            serverFilePath: source.serverFilePath,
            displayTitle: source.displayTitle,
            episodeTitle: source.episodeTitle,
            type: source.type,
            thumbnailUrl: source.thumbnailUrl,
            fileSize: options?.fileSize ?? 0,
            status,
            progress: options?.progress ?? 0,
            startedAt: options?.startedAt ?? Date.now(),
            errorMessage: undefined,
            completedAt: undefined,
            isLocalServerFile: options?.isLocalServerFile ?? false,
        })
    })
}

async function pauseActiveAnimeDownload(key: string, tracker: ActiveDownload): Promise<void> {
    if (tracker.cancelled || tracker.completed || tracker.pausedForAppState) {
        return
    }

    tracker.pausedForAppState = true
    cancelManagedNativeDownload(tracker.downloadId)

    const storedEpisode = getDownloadedEpisode(tracker.mediaId, tracker.episodeId)
    activeDownloads.delete(key)

    markDownloadPending(tracker.mediaId, tracker.episodeId, {
        progress: storedEpisode?.progress ?? tracker.lastProgressValue,
        fileSize: storedEpisode?.fileSize,
    })
    log.info(`Paused download after app backgrounded: ${tracker.episodeId}`)
}

export async function handleAnimeDownloadAppStateChange(nextState: AppStateStatus): Promise<void> {
    currentAppState = nextState

    if (nextState === "active") {
        processNextAnimeQueue()
        return
    }

    if (!shouldPauseAnimeDownloadsForAppState(nextState)) {
        return
    }

    await Promise.allSettled(
        Array.from(activeDownloads.entries()).map(([key, tracker]) => pauseActiveAnimeDownload(key, tracker)),
    )
}

function reportDownloadProgress(
    tracker: ActiveDownload,
    mediaId: number,
    episodeId: string,
    totalBytesWritten: number,
    totalBytesExpectedToWrite: number,
): void {
    if (tracker.cancelled || tracker.completed) return
    if (totalBytesExpectedToWrite <= 0) return

    const nextProgress = Math.max(0, Math.min(totalBytesWritten / totalBytesExpectedToWrite, 1))
    const now = Date.now()
    const shouldPersist =
        tracker.lastProgressAt === 0
        || nextProgress >= 1
        || nextProgress - tracker.lastProgressValue >= DOWNLOAD_PROGRESS_MIN_DELTA
        || now - tracker.lastProgressAt >= DOWNLOAD_PROGRESS_MIN_INTERVAL_MS

    if (!shouldPersist) return

    tracker.lastProgressAt = now
    tracker.lastProgressValue = nextProgress
    updateDownloadProgress(mediaId, episodeId, nextProgress)
}

function cancelAnimeDownloadsForMedia(mediaId: number): void {
    for (let index = queuedDownloads.length - 1; index >= 0; index--) {
        const queued = queuedDownloads[index]
        if (queued?.mediaId !== mediaId) continue
        queued.resolve()
        queuedDownloads.splice(index, 1)
    }

    for (const [key, active] of activeDownloads) {
        if (active.mediaId !== mediaId) continue
        active.cancelled = true
        cancelManagedNativeDownload(active.downloadId)
        activeDownloads.delete(key)
    }
}

async function processQueuedAnimeDownload(item: QueuedAnimeDownload): Promise<void> {
    const key = dlKey(item.mediaId, item.episodeId)
    if (activeDownloads.has(key)) {
        item.resolve()
        return
    }

    const destFile = getEpisodeDestinationFile(item)
    const existing = getDownloadedEpisode(item.mediaId, item.episodeId)
    const shouldKeepProgress = existing?.status === "pending" || existing?.status === "downloading"
    const nativeDownloadId = `anime:${item.mediaId}:${item.episodeId}`

    const tracker: ActiveDownload = {
        mediaId: item.mediaId,
        episodeId: item.episodeId,
        cancelled: false,
        completed: false,
        pausedForAppState: false,
        downloadId: nativeDownloadId,
        lastProgressAt: 0,
        lastProgressValue: 0,
    }
    activeDownloads.set(key, tracker)

    const activeNativeDownload = await getManagedNativeDownload(nativeDownloadId).catch(() => undefined)

    if (!activeNativeDownload && destFile.exists) {
        const fileSize = destFile.size ?? 0
        if (existing?.status !== "failed" && fileSize > 0) {
            markDownloadCompleted(item.mediaId, item.episodeId, destFile.uri, fileSize)
            activeDownloads.delete(key)
            item.resolve()
            processNextAnimeQueue()
            return
        }

        try {
            destFile.delete()
        }
        catch {
        }
    }

    saveEpisodeDownloadRecord(item, activeNativeDownload ? "downloading" : "pending", destFile.uri, {
        startedAt: existing?.startedAt,
        progress: shouldKeepProgress ? existing?.progress : 0,
        fileSize: shouldKeepProgress ? existing?.fileSize : 0,
    })

    const fileUrl = appendServerHMACToken(
        `${getServerBaseUrl(item.serverUrl)}/api/v1/mediastream/file?path=${encodeURIComponent(item.serverFilePath)}`,
        "/api/v1/mediastream/file",
    )

    log.info(`Starting download: ${item.episodeId} -> ${destFile.uri}`)

    try {
        const downloadOptions: ManagedNativeDownloadOptions = {
            id: nativeDownloadId,
            url: fileUrl,
            destinationPath: destFile.uri,
            title: item.displayTitle,
            onProgress: ({ totalBytes, bytesWritten }) => {
                if (tracker.cancelled) return
                reportDownloadProgress(
                    tracker,
                    item.mediaId,
                    item.episodeId,
                    bytesWritten,
                    totalBytes,
                )
            },
        }

        if (activeNativeDownload) {
            await attachManagedNativeDownload(downloadOptions)
        } else {
            await startManagedNativeDownload(downloadOptions)
        }

        if (tracker.pausedForAppState) {
            return
        }

        if (tracker.cancelled) {
            try {
                if (destFile.exists) destFile.delete()
            }
            catch {
            }
            return
        }

        tracker.completed = true
        const fileSize = destFile.size ?? 0
        markDownloadCompleted(item.mediaId, item.episodeId, destFile.uri, fileSize)
        log.info(`Download completed: ${item.episodeId} (${formatBytes(fileSize)})`)
    }
    catch (error: unknown) {
        if (isNativeDownloadCancelledError(error) && tracker.pausedForAppState) {
            return
        }

        if (tracker.cancelled) {
            try {
                if (destFile.exists) destFile.delete()
            }
            catch {
            }
            return
        }

        const msg = error instanceof Error ? error.message : String(error)

        if (tracker.pausedForAppState) {
            return
        }

        if (shouldPauseAnimeDownloadsForAppState() && isBackgroundInterruptionError(msg)) {
            const storedEpisode = getDownloadedEpisode(item.mediaId, item.episodeId)
            markDownloadPending(item.mediaId, item.episodeId, {
                progress: storedEpisode?.progress ?? tracker.lastProgressValue,
                fileSize: storedEpisode?.fileSize,
            })
            log.info(`Deferring interrupted background download: ${item.episodeId}`)
            return
        }

        markDownloadFailed(item.mediaId, item.episodeId, msg)
        log.error(`Download failed: ${item.episodeId}: ${msg}`)
    }
    finally {
        activeDownloads.delete(key)
        item.resolve()
        processNextAnimeQueue()
    }
}

function processNextAnimeQueue(): void {
    // keep lockscreen pauses from immediately restarting work in the background
    if (shouldPauseAnimeDownloadsForAppState()) {
        return
    }

    // native downloads keep active transfers alive, but queue admission stays bounded
    const maxWorkers = Math.max(1, getDownloadWorkerCount())

    while (activeDownloads.size < maxWorkers && queuedDownloads.length > 0) {
        const queued = queuedDownloads.shift()
        if (!queued) return

        void processQueuedAnimeDownload(queued)
    }
}

function enqueueAnimeDownload(source: AnimeDownloadSource, options?: EnqueueAnimeDownloadOptions): Promise<void> {
    if (!source.serverFilePath) {
        return Promise.reject(new Error("Episode has no local file on server"))
    }

    if (activeDownloads.has(dlKey(source.mediaId, source.episodeId)) || hasQueuedAnimeDownload(source.mediaId, source.episodeId)) {
        log.warning(`Download already queued for ${source.mediaId}:${source.episodeId}`)
        return Promise.resolve()
    }

    const existing = getDownloadedEpisode(source.mediaId, source.episodeId)
    if (existing?.status === "completed") {
        return Promise.resolve()
    }

    if (!options?.allowExistingActiveState && (existing?.status === "downloading" || existing?.status === "pending")) {
        return Promise.resolve()
    }

    const destFile = getEpisodeDestinationFile(source)
    const shouldKeepProgress = existing?.status === "pending" || existing?.status === "downloading"
    saveEpisodeDownloadRecord(source, "pending", destFile.uri, {
        startedAt: existing?.startedAt,
        progress: shouldKeepProgress ? existing?.progress : 0,
        fileSize: shouldKeepProgress ? existing?.fileSize : 0,
    })

    return new Promise(resolve => {
        queuedDownloads.push({ ...source, resolve })
        processNextAnimeQueue()
    })
}

////////////////////////// Public API

/**
 * Start downloading an episode from the server.
 */
export async function startEpisodeDownload(
    serverUrl: string,
    entry: Anime_Entry,
    episode: Anime_Episode,
): Promise<void> {
    if (!episode.localFile?.path) {
        throw new Error("Episode has no local file on server")
    }

    saveAnimeDownloadEntrySnapshot(entry)

    const registered = await tryRegisterLocalFile(serverUrl, entry, episode)
    if (registered) return

    await enqueueAnimeDownload(buildEpisodeDownloadSource(serverUrl, entry, episode))
}

/**
 * Start downloading multiple episodes sequentially.
 */
export async function startBatchDownload(
    serverUrl: string,
    entry: Anime_Entry,
    episodes: Anime_Episode[],
): Promise<void> {
    saveAnimeDownloadEntrySnapshot(entry)

    const remainingEpisodes: Anime_Episode[] = []
    for (const episode of episodes) {
        const registered = await tryRegisterLocalFile(serverUrl, entry, episode)
        if (!registered) {
            remainingEpisodes.push(episode)
        }
    }

    if (remainingEpisodes.length === 0) return

    const pendingEpisodes = remainingEpisodes.filter(episode => {
        const episodeId = getDownloadEpisodeId(episode.aniDBEpisode, episode.type, episode.episodeNumber)
        if (activeDownloads.has(dlKey(entry.mediaId, episodeId)) || hasQueuedAnimeDownload(entry.mediaId, episodeId)) {
            return false
        }

        const existing = getDownloadedEpisode(entry.mediaId, episodeId)
        return existing?.status !== "completed" && existing?.status !== "downloading" && existing?.status !== "pending"
    })

    let queuedDownloads: Promise<void>[] = []
    batchDownloadStoreWrites(() => {
        queuedDownloads = pendingEpisodes.map(episode => enqueueAnimeDownload(buildEpisodeDownloadSource(serverUrl, entry, episode)))
    })

    await Promise.all(queuedDownloads)
}

export async function retryAnimeDownload(serverUrl: string, episode: DownloadedEpisode): Promise<void> {
    await enqueueAnimeDownload(buildRetryEpisodeSource(serverUrl, episode))
}

export async function retryFailedAnimeDownloads(serverUrl: string, episodes: DownloadedEpisode[]): Promise<void> {
    let queuedDownloads: Promise<void>[] = []
    batchDownloadStoreWrites(() => {
        queuedDownloads = episodes.map(episode => retryAnimeDownload(serverUrl, episode))
    })

    await Promise.all(queuedDownloads)
}

export async function resumeAnimeDownload(serverUrl: string, episode: DownloadedEpisode): Promise<void> {
    await enqueueAnimeDownload(buildRetryEpisodeSource(serverUrl, episode), { allowExistingActiveState: true })
}

export async function resumeStalledAnimeDownloads(serverUrl: string, episodes: DownloadedEpisode[]): Promise<void> {
    let queuedDownloads: Promise<void>[] = []
    batchDownloadStoreWrites(() => {
        queuedDownloads = episodes.map(episode => resumeAnimeDownload(serverUrl, episode))
    })

    await Promise.all(queuedDownloads)
}

/**
 * Cancel an active download.
 */
export function cancelAnimeDownload(mediaId: number, episodeId: string): void {
    const key = dlKey(mediaId, episodeId)
    const queuedIndex = queuedDownloads.findIndex(item => item.mediaId === mediaId && item.episodeId === episodeId)
    if (queuedIndex >= 0) {
        const [queued] = queuedDownloads.splice(queuedIndex, 1)
        queued?.resolve()
    }

    const active = activeDownloads.get(key)

    if (active) {
        active.cancelled = true
        cancelManagedNativeDownload(active.downloadId)
        activeDownloads.delete(key)
    }

    // remove the incomplete file
    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (ep?.localFilePath) {
        try {
            const file = new File(ep.localFilePath)
            if (file.exists) file.delete()
        }
        catch {
        }
    }

    removeDownloadedEpisode(mediaId, episodeId)
}

/**
 * Delete a downloaded episode file and its record.
 */
export function deleteAnimeDownloadedFile(mediaId: number, episodeId: string): void {
    if (isAnimeDownloadActive(mediaId, episodeId)) {
        cancelAnimeDownload(mediaId, episodeId)
        return
    }

    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (ep?.localFilePath) {
        try {
            const file = new File(ep.localFilePath)
            if (file.exists) file.delete()
        }
        catch {
        }
    }
    removeDownloadedEpisode(mediaId, episodeId)
}

/**
 * Delete all downloaded files for a media.
 */
export async function deleteAllAnimeDownloadsForMedia(mediaId: number): Promise<void> {
    cancelAnimeDownloadsForMedia(mediaId)

    try {
        const dir = getMediaDir(mediaId)
        if (dir.exists) {
            await deleteAsync(dir.uri, { idempotent: true })
        }
    }
    catch {
    }

    removeAllAnimeDownloadsForMedia(mediaId)
}

export function isAnimeDownloadActive(mediaId: number, episodeId: string): boolean {
    return activeDownloads.has(dlKey(mediaId, episodeId)) || hasQueuedAnimeDownload(mediaId, episodeId)
}

export function getAnimeActiveDownloadCount(): number {
    return activeDownloads.size + queuedDownloads.length
}

export function getAnimeDownloadDiskUsage(): number {
    const dir = getDownloadsDir()
    if (!dir.exists) return 0
    return dir.size ?? 0
}

export async function clearAllAnimeDownloads(): Promise<void> {
    for (const queued of queuedDownloads.splice(0, queuedDownloads.length)) {
        queued.resolve()
    }

    // cancel any active downloads
    for (const [, active] of activeDownloads) {
        active.cancelled = true
        cancelManagedNativeDownload(active.downloadId)
    }
    activeDownloads.clear()

    try {
        const dir = getDownloadsDir()
        if (dir.exists) {
            await deleteAsync(dir.uri, { idempotent: true })
        }
    }
    catch {
    }

    clearAllAnimeDownloadRecords()
}

////////////////////////// Helpers

export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function isLocalServer(serverUrlStr: string): boolean {
    if (!serverUrlStr) return false
    try {
        const url = new URL(serverUrlStr)
        const hostname = url.hostname.toLowerCase()
        if (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "::1" ||
            hostname === "0.0.0.0"
        ) {
            return true
        }
    }
    catch {
        if (
            serverUrlStr.includes("localhost") ||
            serverUrlStr.includes("127.0.0.1") ||
            serverUrlStr.includes("::1") ||
            serverUrlStr.includes("0.0.0.0")
        ) {
            return true
        }
    }
    const status = getStoredJsonValue<Status>("sea-server-status")
    const serverOS = status?.os?.toLowerCase()
    if (serverOS === "android" || serverOS === "ios") {
        return true
    }
    return false
}

function toLocalFileUri(path: string): string {
    const encoded = encodeURI(path)
        .replace(/\[/g, "%5B")
        .replace(/\]/g, "%5D")
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F")
    return encoded.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`
}

export async function tryRegisterLocalFile(
    serverUrl: string,
    entry: Anime_Entry,
    episode: Anime_Episode,
): Promise<boolean> {
    if (!isLocalServer(serverUrl)) return false
    const serverFilePath = episode.localFile?.path
    if (!serverFilePath) return false

    const fileUri = toLocalFileUri(serverFilePath)

    let fileSize = 0
    try {
        const rawUrl = `${getServerBaseUrl(serverUrl)}/api/v1/mediastream/file?path=${encodeURIComponent(serverFilePath)}`
        const fileUrl = appendServerHMACToken(rawUrl, "/api/v1/mediastream/file")
        const response = await fetch(fileUrl, { method: "HEAD" })
        const contentLength = response.headers.get("content-length")
        if (contentLength) {
            fileSize = parseInt(contentLength, 10)
        }
    }
    catch {
    }

    if (fileSize === 0) {
        const file = new File(fileUri)
        fileSize = file.exists ? (file.size ?? 0) : 0
    }

    const source = buildEpisodeDownloadSource(serverUrl, entry, episode)
    saveEpisodeDownloadRecord(source, "completed", fileUri, {
        fileSize,
        progress: 1,
        isLocalServerFile: true,
    })
    markDownloadCompleted(source.mediaId, source.episodeId, fileUri, fileSize)
    return true
}

export async function syncLocalServerFilesToDownloads(serverUrl: string): Promise<void> {
    if (isManualOfflineModeEnabled()) return
    if (!isLocalServer(serverUrl)) return

    try {
        const localFiles = await buildSeaQuery<Anime_LocalFile[]>({
            serverUrl,
            endpoint: "/api/v1/library/local-files",
            method: "GET",
            muteError: true,
        })
        if (!Array.isArray(localFiles)) return

        const libraryCollection = await buildSeaQuery<any>({
            serverUrl,
            endpoint: "/api/v1/library/collection",
            method: "GET",
            muteError: true,
        })

        const mediaMap = new Map<number, any>()
        const entryMap = new Map<number, Anime_Entry>()
        if (libraryCollection?.lists) {
            for (const list of libraryCollection.lists) {
                if (list.entries) {
                    for (const entry of list.entries) {
                        if (entry.media) {
                            mediaMap.set(entry.mediaId, entry.media)
                            entryMap.set(entry.mediaId, entry)
                        }
                    }
                }
            }
        }

        const localServerFilePaths = new Set(localFiles.map(lf => lf.path))
        const mediaIds = readGlobalIndex()
        const allLocalRecordsToClean = []

        for (const mediaId of mediaIds) {
            const episodes = getDownloadedEpisodesForMedia(mediaId)
            for (const ep of episodes) {
                if (ep.localFilePath && (ep.isLocalServerFile || !ep.localFilePath.includes("/downloads/"))) {
                    const serverPath = ep.serverFilePath
                    if (!localServerFilePaths.has(serverPath)) {
                        allLocalRecordsToClean.push({ mediaId: ep.mediaId, aniDBEpisode: ep.aniDBEpisode })
                    }
                }
            }
        }

        for (const record of allLocalRecordsToClean) {
            removeDownloadedEpisode(record.mediaId, record.aniDBEpisode)
        }

        const mediaIdsToUpdate = new Set<number>()

        for (const lf of localFiles) {
            if (!lf.path || lf.mediaId === 0 || !lf.metadata) continue

            const fileUri = toLocalFileUri(lf.path)
            const episodeId = getDownloadEpisodeId(lf.metadata.aniDBEpisode, lf.metadata.type, lf.metadata.episode, lf.path)
            const existing = getDownloadedEpisode(lf.mediaId, episodeId)

            if (!existing || existing.status !== "completed" || existing.fileSize === 0) {
                let fileSize = 0
                try {
                    const rawUrl = `${getServerBaseUrl(serverUrl)}/api/v1/mediastream/file?path=${encodeURIComponent(lf.path)}`
                    const fileUrl = appendServerHMACToken(rawUrl, "/api/v1/mediastream/file")
                    const response = await fetch(fileUrl, { method: "HEAD" })
                    const contentLength = response.headers.get("content-length")
                    if (contentLength) {
                        fileSize = parseInt(contentLength, 10)
                    }
                }
                catch (e) {
                    log.error("Failed to get file size via HEAD request", e)
                }

                if (fileSize === 0) {
                    const file = new File(fileUri)
                    fileSize = file.exists ? (file.size ?? 0) : 0
                }

                const media = mediaMap.get(lf.mediaId)
                const animeInfo = {
                    mediaId: lf.mediaId,
                    title: media?.title?.english
                        || media?.title?.romaji
                        || media?.title?.userPreferred
                        || `Anime #${lf.mediaId}`,
                    coverImageUrl: media?.coverImage?.large,
                    bannerImageUrl: media?.bannerImage,
                    totalEpisodes: media?.episodes,
                    downloadedCount: 0,
                }

                const displayTitle = lf.metadata.type === "main"
                    ? `Episode ${lf.metadata.episode}`
                    : `${lf.metadata.type.toUpperCase()} Episode ${lf.metadata.episode}`

                batchDownloadStoreWrites(() => {
                    saveAnimeInfo(animeInfo)
                    saveDownloadedEpisode({
                        mediaId: lf.mediaId,
                        episodeNumber: lf.metadata!.episode,
                        aniDBEpisode: episodeId,
                        localFilePath: fileUri,
                        serverFilePath: lf.path,
                        displayTitle,
                        episodeTitle: "",
                        type: lf.metadata!.type as "main" | "special" | "nc",
                        thumbnailUrl: media?.bannerImage,
                        fileSize,
                        status: "completed",
                        progress: 1,
                        startedAt: Date.now(),
                        completedAt: Date.now(),
                        isLocalServerFile: true,
                    })
                })
                mediaIdsToUpdate.add(lf.mediaId)
            } else if (existing.isLocalServerFile === undefined) {
                batchDownloadStoreWrites(() => {
                    existing.isLocalServerFile = true
                    saveDownloadedEpisode(existing)
                })
            }
        }

        const allCompletedMediaIds = new Set<number>()
        for (const lf of localFiles) {
            if (lf.mediaId && lf.mediaId !== 0) {
                allCompletedMediaIds.add(lf.mediaId)
            }
        }

        batchDownloadStoreWrites(() => {
            for (const mediaId of allCompletedMediaIds) {
                updateAnimeInfoDownloadCount(mediaId)
                const entry = entryMap.get(mediaId)
                if (entry) {
                    saveAnimeDownloadEntrySnapshot(entry)
                }
            }
        })
    }
    catch (e: any) {
        if (e?.message !== "OFFLINE_MODE_ENABLED") {
            log.warning("syncLocalServerFilesToDownloads failed", e)
        }
    }
}

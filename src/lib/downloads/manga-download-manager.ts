import { appendServerHMACToken, getServerAuthHeaders } from "@/api/client/server-auth"
import { getServerBaseUrl } from "@/api/client/server-url"
import { Manga_Entry, Manga_PageContainer } from "@/api/generated/types"
import { getDownloadSettings, getDownloadWorkerCount } from "@/atoms/download-settings.atoms"
import {
    batchMangaDownloadStoreWrites,
    clearAllMangaDownloadRecords,
    type DownloadedMangaChapter,
    getDownloadedMangaChapter,
    getMangaInfo,
    markMangaChapterCompleted,
    markMangaChapterFailed,
    markMangaChapterPending,
    removeAllMangaDownloadsForMedia,
    removeDownloadedMangaChapter,
    saveDownloadedMangaChapter,
    saveMangaInfo,
    updateMangaChapterProgress,
} from "@/lib/downloads/manga-download-store"
import {
    attachManagedNativeDownload,
    cancelManagedNativeDownload,
    getManagedNativeDownload,
    isNativeDownloadCancelledError,
    type ManagedNativeDownloadOptions,
    startManagedNativeDownload,
} from "@/lib/downloads/native-download"
import { saveMangaDownloadEntrySnapshot } from "@/lib/offline/download-entry-snapshot-store"
import { logger } from "@/lib/utils/logger"
import { Directory, File, Paths } from "expo-file-system"
import { deleteAsync } from "expo-file-system/legacy"
import { AppState, type AppStateStatus, Platform } from "react-native"

const log = logger("manga-dl")

const PAGE_CONCURRENCY = 4
const MANGA_PROGRESS_MIN_PAGE_DELTA = 2
const MANGA_PROGRESS_MIN_INTERVAL_MS = 250
const PAGE_CONTAINER_RETRY_ATTEMPTS = 3
const PAGE_CONTAINER_RETRY_BASE_DELAY_MS = 1_200

////////////////////////// Directory structure

function getMangaDownloadsDir(): Directory {
    return new Directory(Paths.document, "manga-downloads")
}

function getMediaDir(mediaId: number): Directory {
    return new Directory(getMangaDownloadsDir(), String(mediaId))
}

function getChapterDir(mediaId: number, provider: string, chapterId: string): Directory {
    // sanitize provider and chapterId for filesystem
    const safeProvider = provider.replace(/[^a-zA-Z0-9_-]/g, "_")
    const safeChapterId = chapterId.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return new Directory(getMediaDir(mediaId), `${safeProvider}_${safeChapterId}`)
}

function getPageFileName(index: number, url: string): string {
    // try to extract extension from URL
    const urlPath = url.split("?")[0]
    const ext = urlPath.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "jpg"
    const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext) ? ext : "jpg"
    return `page-${String(index).padStart(4, "0")}.${safeExt}`
}

function ensureDir(dir: Directory): void {
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true })
    }
}

////////////////////////// Queue management

type QueueItem = {
    mediaId: number
    provider: string
    chapterId: string
    chapterNumber: string
    title: string
    scanlator?: string
}

type QueueMangaChapterDownloadOptions = {
    allowExistingActiveState?: boolean
}

type ActiveMangaDownload = {
    mediaId: number
    provider: string
    chapterId: string
    cancelled: boolean
    pausedForAppState: boolean
    activeNativeDownloadIds: Set<string>
    lastProgressAt: number
    lastProgressPagesDownloaded: number
}

const downloadQueue: QueueItem[] = []
const activeDownloads = new Map<string, ActiveMangaDownload>()
let serverUrl: string = ""
let currentAppState: AppStateStatus = AppState.currentState

function queueKey(mediaId: number, provider: string, chapterId: string): string {
    return `${mediaId}:${provider}:${chapterId}`
}

function isCurrentMangaChapterDownload(mediaId: number, provider: string, chapterId: string): boolean {
    const active = activeDownloads.get(queueKey(mediaId, provider, chapterId))
    return Boolean(active && !active.cancelled)
}

function shouldPauseMangaDownloadsForAppState(nextState: AppStateStatus = currentAppState): boolean {
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

function isQueuedMangaChapterDownload(mediaId: number, provider: string, chapterId: string): boolean {
    return downloadQueue.some(item => (
        item.mediaId === mediaId
        && item.provider === provider
        && item.chapterId === chapterId
    ))
}

function getMangaWorkerCount(): number {
    return Math.max(1, getDownloadWorkerCount())
}

function getPageWorkerCount(pendingPageCount: number): number {
    // ios background sessions need every page task submitted before js is suspended
    if (Platform.OS === "ios" && getDownloadSettings().backgroundDownloading) {
        return pendingPageCount
    }

    return Math.min(PAGE_CONCURRENCY, pendingPageCount)
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function getRetryAfterDelayMs(res: Response): number | undefined {
    const retryAfter = res.headers.get("retry-after")
    if (!retryAfter) return undefined

    const retryAfterSeconds = Number(retryAfter)
    if (Number.isFinite(retryAfterSeconds)) {
        return Math.max(0, retryAfterSeconds * 1000)
    }

    const retryAfterDate = Date.parse(retryAfter)
    if (Number.isNaN(retryAfterDate)) return undefined

    return Math.max(0, retryAfterDate - Date.now())
}

function cancelMangaDownloadsForMedia(mediaId: number): void {
    for (let index = downloadQueue.length - 1; index >= 0; index--) {
        if (downloadQueue[index]?.mediaId === mediaId) {
            downloadQueue.splice(index, 1)
        }
    }

    for (const active of activeDownloads.values()) {
        if (active.mediaId === mediaId) {
            active.cancelled = true
            for (const downloadId of active.activeNativeDownloadIds) {
                cancelManagedNativeDownload(downloadId)
            }
        }
    }
}

function queueMangaChapterDownload(item: QueueItem, options?: QueueMangaChapterDownloadOptions): boolean {
    const existing = getDownloadedMangaChapter(item.mediaId, item.provider, item.chapterId)
    if (
        existing?.status === "completed"
        || isQueuedMangaChapterDownload(item.mediaId, item.provider, item.chapterId)
        || isCurrentMangaChapterDownload(item.mediaId, item.provider, item.chapterId)
    ) {
        return false
    }

    if (!options?.allowExistingActiveState && (existing?.status === "downloading" || existing?.status === "pending")) {
        return false
    }

    const shouldResetPartialDownload = existing?.status === "failed"

    if (shouldResetPartialDownload) {
        try {
            const dir = getChapterDir(item.mediaId, item.provider, item.chapterId)
            if (dir.exists) dir.delete()
        }
        catch {
        }
    }

    downloadQueue.push(item)
    saveDownloadedMangaChapter({
        mediaId: item.mediaId,
        provider: item.provider,
        chapterId: item.chapterId,
        chapterNumber: item.chapterNumber,
        title: item.title,
        scanlator: item.scanlator,
        totalPages: shouldResetPartialDownload ? 0 : (existing?.totalPages ?? 0),
        pagesDownloaded: shouldResetPartialDownload ? 0 : (existing?.pagesDownloaded ?? 0),
        localDir: getChapterDir(item.mediaId, item.provider, item.chapterId).uri,
        status: "pending",
        progress: shouldResetPartialDownload ? 0 : (existing?.progress ?? 0),
        startedAt: existing?.startedAt ?? Date.now(),
    })

    return true
}

function reportMangaChapterProgress(
    tracker: {
        mediaId: number
        provider: string
        chapterId: string
        cancelled: boolean
        lastProgressAt: number
        lastProgressPagesDownloaded: number
    },
    downloaded: number,
    total: number,
): void {
    if (tracker.cancelled || total <= 0) return

    const now = Date.now()
    const shouldPersist = tracker.lastProgressAt === 0
        || downloaded >= total
        || downloaded - tracker.lastProgressPagesDownloaded >= MANGA_PROGRESS_MIN_PAGE_DELTA
        || now - tracker.lastProgressAt >= MANGA_PROGRESS_MIN_INTERVAL_MS

    if (!shouldPersist) return

    tracker.lastProgressAt = now
    tracker.lastProgressPagesDownloaded = downloaded
    updateMangaChapterProgress(tracker.mediaId, tracker.provider, tracker.chapterId, downloaded, total)
}

function resolvePageUrl(
    baseUrl: string,
    pageUrl: string,
    headers?: Record<string, string>,
    isDownloaded?: boolean,
): string {
    // local manga pages
    if (pageUrl.startsWith("{{manga-local-assets}}")) {
        const assetPath = encodeURIComponent(pageUrl)
        return appendServerHMACToken(
            `${baseUrl}/api/v1/manga/local-page/${assetPath}`,
            "/api/v1/manga/local-page",
        )
    }

    // pages needing auth headers go through server proxy
    if (!isDownloaded && headers && Object.keys(headers).length > 0) {
        return appendServerHMACToken(
            `${baseUrl}/api/v1/image-proxy?url=${encodeURIComponent(pageUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}`,
            "/api/v1/image-proxy",
        )
    }

    // direct URL
    return pageUrl
}

function normalizeDownloadedPageDimensions(
    pageDimensions: Manga_PageContainer["pageDimensions"] | undefined,
): DownloadedMangaChapter["pageDimensions"] | undefined {
    if (!pageDimensions || Object.keys(pageDimensions).length === 0) return undefined

    const normalizedEntries = Object.entries(pageDimensions)
        .filter(([, dimension]) => Boolean(dimension?.width && dimension?.height))
        .map(([pageIndex, dimension]) => [Number(pageIndex), {
            width: dimension!.width,
            height: dimension!.height,
        }] as const)

    if (normalizedEntries.length === 0) return undefined

    return Object.fromEntries(normalizedEntries)
}

////////////////////////// Chapter download logic

async function fetchPageContainer(
    baseUrl: string,
    mediaId: number,
    provider: string,
    chapterId: string,
): Promise<Manga_PageContainer> {
    for (let attempt = 0; attempt <= PAGE_CONTAINER_RETRY_ATTEMPTS; attempt++) {
        const res = await fetch(`${baseUrl}/api/v1/manga/pages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getServerAuthHeaders(),
            },
            // downloads keep pages so offline readers do not have to measure images later
            body: JSON.stringify({ mediaId, provider, chapterId, doublePage: true }),
        })

        if (res.ok) {
            const json = await res.json()
            if (json.data) return json.data as Manga_PageContainer
            return json as Manga_PageContainer
        }

        const shouldRetry = res.status === 429 || res.status >= 500
        if (!shouldRetry || attempt >= PAGE_CONTAINER_RETRY_ATTEMPTS) {
            throw new Error(`Failed to fetch pages: ${res.status} ${res.statusText}`)
        }

        const retryDelay = getRetryAfterDelayMs(res) ?? PAGE_CONTAINER_RETRY_BASE_DELAY_MS * (attempt + 1)
        log.warning(`Page fetch throttled for chapter ${chapterId}, retrying in ${retryDelay}ms`)
        await wait(retryDelay)
    }

    throw new Error("Failed to fetch pages")
}

async function downloadChapterPages(
    baseUrl: string,
    mediaId: number,
    provider: string,
    chapterId: string,
    chapterDir: Directory,
    activeNativeDownloadIds: Set<string>,
    onProgress: (downloaded: number, total: number) => void,
    isCancelled: () => boolean,
): Promise<number> {
    const pageContainer = await fetchPageContainer(baseUrl, mediaId, provider, chapterId)
    const pages = pageContainer.pages ?? []
    if (pages.length === 0) throw new Error("Chapter has no pages")

    const total = pages.length
    const pageDimensions = normalizeDownloadedPageDimensions(pageContainer.pageDimensions)
    const existingChapter = getDownloadedMangaChapter(mediaId, provider, chapterId)

    if (existingChapter && pageDimensions) {
        saveDownloadedMangaChapter({
            ...existingChapter,
            totalPages: total,
            pageDimensions,
        })
    }

    let downloaded = 0

    const queue = pages.filter(page => {
        const destFile = new File(chapterDir, getPageFileName(page.index, page.url))
        if (destFile.exists) {
            downloaded++
            return false
        }

        return true
    })

    onProgress(downloaded, total)

    if (downloaded >= total || isCancelled()) {
        return total
    }

    const downloadPage = async (page: (typeof queue)[number]) => {
        if (isCancelled()) return

        const pageUrl = resolvePageUrl(baseUrl, page.url, page.headers, pageContainer.isDownloaded)
        const fileName = getPageFileName(page.index, page.url)
        const destFile = new File(chapterDir, fileName)
        const downloadId = `manga:${mediaId}:${provider}:${chapterId}:${page.index}`
        const downloadOptions: ManagedNativeDownloadOptions = {
            id: downloadId,
            url: pageUrl,
            destinationPath: destFile.uri,
            title: `Downloading chapter ${chapterId}`,
        }

        const runPageDownload = async () => {
            const activeNativeDownload = await getManagedNativeDownload(downloadId).catch(() => undefined)
            activeNativeDownloadIds.add(downloadId)
            try {
                if (activeNativeDownload) {
                    await attachManagedNativeDownload(downloadOptions)
                } else {
                    await startManagedNativeDownload(downloadOptions)
                }
            }
            finally {
                activeNativeDownloadIds.delete(downloadId)
            }
        }

        try {
            await runPageDownload()
            if (isCancelled()) return
            downloaded++
            onProgress(downloaded, total)
        }
        catch (err) {
            if (isNativeDownloadCancelledError(err) && isCancelled()) return
            if (isCancelled()) return

            // retry once
            try {
                await runPageDownload()
                if (isCancelled()) return
                downloaded++
                onProgress(downloaded, total)
            }
            catch (retryErr) {
                if (isNativeDownloadCancelledError(retryErr) && isCancelled()) return
                if (isCancelled()) return

                log.error(`Failed page ${page.index}: ${retryErr}`)
                throw retryErr
            }
        }
    }

    const pendingPages = [...queue]
    const workers = Array.from({ length: getPageWorkerCount(pendingPages.length) }, async () => {
        while (pendingPages.length > 0) {
            if (isCancelled()) return

            const page = pendingPages.shift()
            if (!page) return

            await downloadPage(page)
        }
    })

    await Promise.all(workers)
    return total
}

async function processQueueItem(item: QueueItem): Promise<void> {
    const { mediaId, provider, chapterId, chapterNumber, title, scanlator } = item
    const existing = getDownloadedMangaChapter(mediaId, provider, chapterId)
    if (existing?.status === "completed") {
        processNextInQueue()
        return
    }

    const tracker = {
        mediaId,
        provider,
        chapterId,
        cancelled: false,
        pausedForAppState: false,
        activeNativeDownloadIds: new Set<string>(),
        lastProgressAt: 0,
        lastProgressPagesDownloaded: 0,
    }
    const trackerKey = queueKey(mediaId, provider, chapterId)
    activeDownloads.set(trackerKey, tracker)

    const chapterDir = getChapterDir(mediaId, provider, chapterId)
    ensureDir(chapterDir)

    const record: DownloadedMangaChapter = {
        mediaId,
        provider,
        chapterId,
        chapterNumber,
        title,
        scanlator,
        totalPages: existing?.totalPages ?? 0,
        pagesDownloaded: existing?.pagesDownloaded ?? 0,
        localDir: chapterDir.uri,
        status: "downloading",
        progress: existing?.progress ?? 0,
        startedAt: existing?.startedAt ?? Date.now(),
    }
    saveDownloadedMangaChapter(record)

    const baseUrl = getServerBaseUrl(serverUrl)
    log.info(`Downloading chapter ${chapterNumber} (${chapterId}) for media ${mediaId}`)

    try {
        const totalPages = await downloadChapterPages(
            baseUrl,
            mediaId,
            provider,
            chapterId,
            chapterDir,
            tracker.activeNativeDownloadIds,
            (downloaded, total) => {
                reportMangaChapterProgress(tracker, downloaded, total)
            },
            () => tracker.cancelled,
        )

        if (tracker.cancelled) {
            if (tracker.pausedForAppState) {
                const current = getDownloadedMangaChapter(mediaId, provider, chapterId)
                markMangaChapterPending(mediaId, provider, chapterId, {
                    pagesDownloaded: current?.pagesDownloaded,
                    totalPages: current?.totalPages ?? totalPages,
                })
                log.info(`Paused chapter download after app backgrounded: ${chapterId}`)
                return
            }

            try {
                if (chapterDir.exists) chapterDir.delete()
            }
            catch {
            }
            log.info(`Chapter download cancelled: ${chapterId}`)
            return
        }

        markMangaChapterCompleted(mediaId, provider, chapterId, chapterDir.uri, totalPages)
        log.info(`Chapter ${chapterNumber} completed (${totalPages} pages)`)
    }
    catch (error: unknown) {
        if (tracker.cancelled) {
            try {
                if (chapterDir.exists) chapterDir.delete()
            }
            catch {
            }
            return
        }

        const msg = error instanceof Error ? error.message : String(error)

        if (tracker.pausedForAppState) {
            const current = getDownloadedMangaChapter(mediaId, provider, chapterId)
            markMangaChapterPending(mediaId, provider, chapterId, {
                pagesDownloaded: current?.pagesDownloaded,
                totalPages: current?.totalPages,
            })
            return
        }

        if (shouldPauseMangaDownloadsForAppState() && isBackgroundInterruptionError(msg)) {
            const current = getDownloadedMangaChapter(mediaId, provider, chapterId)
            markMangaChapterPending(mediaId, provider, chapterId, {
                pagesDownloaded: current?.pagesDownloaded,
                totalPages: current?.totalPages,
            })
            log.info(`Deferring interrupted background manga download: ${chapterId}`)
            return
        }

        markMangaChapterFailed(mediaId, provider, chapterId, msg)
        log.error(`Chapter ${chapterNumber} failed: ${msg}`)
    }
    finally {
        activeDownloads.delete(trackerKey)
        processNextInQueue()
    }
}

function processNextInQueue(): void {
    if (shouldPauseMangaDownloadsForAppState()) {
        return
    }

    const maxWorkers = getMangaWorkerCount()

    // check if any active download is for local-manga
    let hasActiveLocalManga = Array.from(activeDownloads.values()).some(
        d => d.provider === "local-manga",
    )

    let activeCount = activeDownloads.size

    for (let i = 0; i < downloadQueue.length; i++) {
        if (activeCount >= maxWorkers) {
            break
        }

        const nextItem = downloadQueue[i]
        if (!nextItem) continue

        const isLocalManga = nextItem.provider === "local-manga"

        // serialize local-manga downloads to prevent backend cache pollution until i fix it
        if (isLocalManga && hasActiveLocalManga) {
            continue
        }

        downloadQueue.splice(i, 1)
        i--

        if (isLocalManga) {
            hasActiveLocalManga = true
        }

        void processQueueItem(nextItem)
        activeCount++
    }
}

export function handleMangaDownloadAppStateChange(nextState: AppStateStatus): void {
    currentAppState = nextState

    if (nextState === "active") {
        processNextInQueue()
        return
    }

    if (!shouldPauseMangaDownloadsForAppState(nextState)) {
        return
    }

    if (activeDownloads.size > 0) {
        log.info("Pausing manga downloads for app state", {
            appState: nextState,
            activeCount: activeDownloads.size,
        })
    }

    for (const tracker of activeDownloads.values()) {
        tracker.pausedForAppState = true
        tracker.cancelled = true
        for (const downloadId of tracker.activeNativeDownloadIds) {
            cancelManagedNativeDownload(downloadId)
        }
    }
}

////////////////////////// API

export function setMangaDownloadServerUrl(url: string): void {
    serverUrl = url
}

/**
 * Enqueue chapters for local download.
 */
export function enqueueMangaChapterDownloads(
    sUrl: string,
    entry: Manga_Entry,
    provider: string,
    chapters: Array<{
        chapterId: string
        chapterNumber: string
        title: string
        scanlator?: string
    }>,
): void {
    const mediaId = entry.mediaId
    serverUrl = sUrl

    saveMangaDownloadEntrySnapshot(entry)

    const mangaTitle = entry.media?.title?.english
        || entry.media?.title?.romaji
        || entry.media?.title?.userPreferred
        || `Manga #${mediaId}`
    const coverImageUrl = entry.media?.coverImage?.large ?? entry.media?.coverImage?.large

    let queuedCount = 0
    batchMangaDownloadStoreWrites(() => {
        saveMangaInfo({
            mediaId,
            title: mangaTitle,
            coverImageUrl,
            downloadedCount: 0,
        })

        for (const ch of chapters) {
            const queued = queueMangaChapterDownload({
                mediaId,
                provider,
                chapterId: ch.chapterId,
                chapterNumber: ch.chapterNumber,
                title: ch.title,
                scanlator: ch.scanlator,
            })
            if (queued) queuedCount++
        }
    })

    log.info("Manga chapter batch requested", {
        mediaId,
        provider,
        requested: chapters.length,
        queued: queuedCount,
        skipped: chapters.length - queuedCount,
    })

    // start processing if not already
    processNextInQueue()
}

export function retryMangaChapterDownload(sUrl: string, chapter: DownloadedMangaChapter): void {
    serverUrl = sUrl

    let queued = false
    batchMangaDownloadStoreWrites(() => {
        const mangaInfo = getMangaInfo(chapter.mediaId)
        if (!mangaInfo) {
            saveMangaInfo({
                mediaId: chapter.mediaId,
                title: `Manga #${chapter.mediaId}`,
                downloadedCount: 0,
            })
        }

        queued = queueMangaChapterDownload({
            mediaId: chapter.mediaId,
            provider: chapter.provider,
            chapterId: chapter.chapterId,
            chapterNumber: chapter.chapterNumber,
            title: chapter.title,
            scanlator: chapter.scanlator,
        })
    })

    if (queued) {
        processNextInQueue()
    }
}

export function retryFailedMangaDownloads(sUrl: string, chapters: DownloadedMangaChapter[]): void {
    log.info("Retrying failed manga downloads", { count: chapters.length })
    serverUrl = sUrl
    batchMangaDownloadStoreWrites(() => {
        for (const chapter of chapters) {
            retryMangaChapterDownload(sUrl, chapter)
        }
    })
}

export function resumeMangaChapterDownload(sUrl: string, chapter: DownloadedMangaChapter): void {
    serverUrl = sUrl

    let queued = false
    batchMangaDownloadStoreWrites(() => {
        const mangaInfo = getMangaInfo(chapter.mediaId)
        if (!mangaInfo) {
            saveMangaInfo({
                mediaId: chapter.mediaId,
                title: `Manga #${chapter.mediaId}`,
                downloadedCount: 0,
            })
        }

        queued = queueMangaChapterDownload({
            mediaId: chapter.mediaId,
            provider: chapter.provider,
            chapterId: chapter.chapterId,
            chapterNumber: chapter.chapterNumber,
            title: chapter.title,
            scanlator: chapter.scanlator,
        }, { allowExistingActiveState: true })
    })

    if (queued) {
        processNextInQueue()
    }
}

export function resumeStalledMangaDownloads(sUrl: string, chapters: DownloadedMangaChapter[]): void {
    log.info("Resuming stalled manga downloads", { count: chapters.length })
    serverUrl = sUrl
    batchMangaDownloadStoreWrites(() => {
        for (const chapter of chapters) {
            resumeMangaChapterDownload(sUrl, chapter)
        }
    })
}

/**
 * Cancel the current active download and clear the queue.
 */
export function cancelAllMangaDownloads(): void {
    const queuedCount = downloadQueue.length
    const activeCount = activeDownloads.size
    downloadQueue.length = 0
    for (const active of activeDownloads.values()) {
        active.cancelled = true
        for (const downloadId of active.activeNativeDownloadIds) {
            cancelManagedNativeDownload(downloadId)
        }
    }
    log.info("Cancelled all manga downloads", { queuedCount, activeCount })
}

/**
 * Cancel a specific chapter download.
 * If it's the active download, it will be cancelled.
 * If it's in the queue, it will be removed.
 */
export function cancelMangaChapterDownload(mediaId: number, provider: string, chapterId: string): void {
    // remove from queue
    const qIdx = downloadQueue.findIndex(
        q => q.mediaId === mediaId && q.provider === provider && q.chapterId === chapterId,
    )
    if (qIdx >= 0) downloadQueue.splice(qIdx, 1)

    // cancel if active
    const active = activeDownloads.get(queueKey(mediaId, provider, chapterId))
    if (active) {
        active.cancelled = true
        for (const downloadId of active.activeNativeDownloadIds) {
            cancelManagedNativeDownload(downloadId)
        }
    }

    // remove the incomplete files
    try {
        const dir = getChapterDir(mediaId, provider, chapterId)
        if (dir.exists) dir.delete()
    }
    catch (error) {
        log.warning("Failed to remove cancelled manga chapter files", {
            mediaId,
            provider,
            chapterId,
        }, error)
    }

    removeDownloadedMangaChapter(mediaId, provider, chapterId)
    log.info("Manga chapter download cancelled", {
        mediaId,
        provider,
        chapterId,
        wasQueued: qIdx >= 0,
        wasActive: !!active,
    })
}

/**
 * Delete a downloaded chapter, removes files and MMKV record.
 */
export function deleteMangaChapterDownload(mediaId: number, provider: string, chapterId: string): void {
    if (isQueuedMangaChapterDownload(mediaId, provider, chapterId) || isCurrentMangaChapterDownload(mediaId, provider, chapterId)) {
        cancelMangaChapterDownload(mediaId, provider, chapterId)
        return
    }

    try {
        const dir = getChapterDir(mediaId, provider, chapterId)
        if (dir.exists) dir.delete()
    }
    catch (error) {
        log.warning("Failed to remove manga chapter files", { mediaId, provider, chapterId }, error)
    }
    removeDownloadedMangaChapter(mediaId, provider, chapterId)
    log.info("Manga chapter download removed", { mediaId, provider, chapterId })
}

export async function deleteAllMangaDownloadsForMedia(mediaId: number): Promise<void> {
    log.info("Removing all manga downloads for media", { mediaId })
    cancelMangaDownloadsForMedia(mediaId)
    try {
        const dir = getMediaDir(mediaId)
        if (dir.exists) {
            await deleteAsync(dir.uri, { idempotent: true })
        }
    }
    catch (error) {
        log.warning("Failed to remove manga download directory", { mediaId }, error)
    }
    removeAllMangaDownloadsForMedia(mediaId)
}

export async function clearAllMangaDownloads(): Promise<void> {
    cancelAllMangaDownloads()
    try {
        const dir = getMangaDownloadsDir()
        if (dir.exists) {
            await deleteAsync(dir.uri, { idempotent: true })
        }
    }
    catch (error) {
        log.warning("Failed to clear manga download directory", error)
    }
    clearAllMangaDownloadRecords()
    log.info("Cleared all manga downloads")
}

/**
 * Get the local page file paths for a downloaded chapter, sorted by page index.
 */
export function getLocalChapterPages(mediaId: number, provider: string, chapterId: string): string[] {
    const dir = getChapterDir(mediaId, provider, chapterId)
    if (!dir.exists) return []

    try {
        const files = dir.list()
        return files
            .filter(f => f instanceof File)
            .map(f => (f as File).uri)
            .sort()
    }
    catch {
        return []
    }
}

export function getMangaDownloadQueueLength(): number {
    return downloadQueue.length + activeDownloads.size
}

export function isMangaChapterDownloading(mediaId: number, provider: string, chapterId: string): boolean {
    return isCurrentMangaChapterDownload(mediaId, provider, chapterId)
}

export function isMangaChapterActive(mediaId: number, provider: string, chapterId: string): boolean {
    return isQueuedMangaChapterDownload(mediaId, provider, chapterId) || isCurrentMangaChapterDownload(mediaId, provider, chapterId)
}

export function getMangaDownloadDiskUsage(): number {
    const dir = getMangaDownloadsDir()
    if (!dir.exists) return 0
    return dir.size ?? 0
}

// helper for formatting
export { formatBytes } from "@/lib/downloads/download-manager"

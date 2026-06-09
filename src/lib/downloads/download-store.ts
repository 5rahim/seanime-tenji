import { removeDownloadEntrySnapshot } from "@/lib/offline/download-entry-snapshot-store"
import { Paths } from "expo-file-system"
import { createMMKV } from "react-native-mmkv"

const store = createMMKV({ id: "seanime-downloads" })

export type DownloadStatus = "pending" | "downloading" | "completed" | "failed"

export type DownloadedEpisode = {
    mediaId: number
    episodeNumber: number
    aniDBEpisode: string
    localFilePath: string
    serverFilePath: string
    displayTitle: string
    episodeTitle: string
    type: "main" | "special" | "nc"
    thumbnailUrl?: string
    fileSize: number
    status: DownloadStatus
    progress: number
    startedAt: number
    completedAt?: number
    errorMessage?: string
    isLocalServerFile?: boolean
}

export type DownloadedAnimeInfo = {
    mediaId: number
    title: string
    coverImageUrl?: string
    bannerImageUrl?: string
    totalEpisodes?: number
    downloadedCount: number
}

export function getDownloadEpisodeId(aniDBEpisode: string | undefined, type: string, episodeNumber: number, uniqueHint?: string): string {
    if (type === "main") return aniDBEpisode || `${type}-${episodeNumber}`

    const base = aniDBEpisode ? `${type}-${aniDBEpisode}` : `${type}-${episodeNumber}`

    return uniqueHint ? `${base}-${hashEpisodeIdHint(uniqueHint)}` : base
}

function hashEpisodeIdHint(value: string): string {
    let hash = 0

    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
    }

    return Math.abs(hash).toString(36)
}

////////////////////////// Helpers

function episodeKey(mediaId: number, episodeId: string): string {
    return `ep:${mediaId}:${episodeId}`
}

function mediaIndexKey(mediaId: number): string {
    return `media-eps:${mediaId}`
}

function animeInfoKey(mediaId: number): string {
    return `anime:${mediaId}`
}

const GLOBAL_INDEX_KEY = "global-index"

/**
 * Resolve a stored localFilePath to the current app container path.
 *
 * iOS changes the Application UUID on every app reinstall, so absolute paths stored in MMKV become stale. We extract the relative portion
 * (downloads/{mediaId}/ep-{id}.{ext}) and re-root it under the current documents directory.
 */
function resolveLocalFilePath(storedPath: string): string {
    // Match the relative download portion from the stored path
    const marker = "/downloads/"
    const idx = storedPath.lastIndexOf(marker)
    if (idx === -1) return storedPath

    const relativePart = storedPath.slice(idx + 1) // "downloads/{mediaId}/ep-xxx.ext"
    return `${Paths.document.uri}/${relativePart}`
}

function readEpisodeIndex(mediaId: number): string[] {
    const raw = store.getString(mediaIndexKey(mediaId))
    if (!raw) return []
    try {
        return JSON.parse(raw) as string[]
    }
    catch {
        return []
    }
}

function writeEpisodeIndex(mediaId: number, episodeIds: string[]): void {
    store.set(mediaIndexKey(mediaId), JSON.stringify(episodeIds))
}

export function readGlobalIndex(): number[] {
    const raw = store.getString(GLOBAL_INDEX_KEY)
    if (!raw) return []
    try {
        return JSON.parse(raw) as number[]
    }
    catch {
        return []
    }
}

function writeGlobalIndex(ids: number[]): void {
    store.set(GLOBAL_INDEX_KEY, JSON.stringify(ids))
}

////////////////////////// Revision counter for reactive updates

const REVISION_KEY = "rev"
let revisionBatchDepth = 0
let hasPendingRevision = false

function flushRevision(): void {
    if (!hasPendingRevision) return
    hasPendingRevision = false
    const rev = store.getNumber(REVISION_KEY) ?? 0
    store.set(REVISION_KEY, rev + 1)
}

export function getDownloadRevision(): number {
    return store.getNumber(REVISION_KEY) ?? 0
}

export function subscribeToDownloadChanges(callback: () => void): () => void {
    const listener = store.addOnValueChangedListener((key) => {
        if (key === REVISION_KEY) callback()
    })
    return () => listener.remove()
}

function notifyChange(): void {
    hasPendingRevision = true
    if (revisionBatchDepth > 0) return
    flushRevision()
}

export function batchDownloadStoreWrites<T>(write: () => T): T {
    revisionBatchDepth++
    try {
        return write()
    }
    finally {
        revisionBatchDepth = Math.max(0, revisionBatchDepth - 1)
        if (revisionBatchDepth === 0) {
            flushRevision()
        }
    }
}

////////////////////////// API

export function saveDownloadedEpisode(episode: DownloadedEpisode): void {
    store.set(episodeKey(episode.mediaId, episode.aniDBEpisode), JSON.stringify(episode))

    // update episode index for this media
    const eps = readEpisodeIndex(episode.mediaId)
    if (!eps.includes(episode.aniDBEpisode)) {
        eps.push(episode.aniDBEpisode)
        writeEpisodeIndex(episode.mediaId, eps)
    }

    // update global index
    const global = readGlobalIndex()
    if (!global.includes(episode.mediaId)) {
        global.push(episode.mediaId)
        writeGlobalIndex(global)
    }

    notifyChange()
}

export function updateDownloadProgress(mediaId: number, episodeId: string, progress: number, fileSize?: number): void {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (!ep) return

    if (ep.status === "completed" || ep.status === "failed") {
        return
    }

    const nextProgress = Math.max(0, Math.min(progress, 1))
    const nextFileSize = fileSize ?? ep.fileSize

    if (ep.status === "downloading" && ep.progress === nextProgress && ep.fileSize === nextFileSize) {
        return
    }

    ep.progress = nextProgress
    ep.status = "downloading"
    ep.fileSize = nextFileSize
    ep.errorMessage = undefined
    store.set(episodeKey(mediaId, episodeId), JSON.stringify(ep))
    notifyChange()
}

export function markDownloadPending(
    mediaId: number,
    episodeId: string,
    options?: {
        progress?: number
        fileSize?: number
    },
): void {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (!ep) return

    ep.status = "pending"
    ep.progress = Math.max(0, Math.min(options?.progress ?? ep.progress, 1))
    ep.fileSize = options?.fileSize ?? ep.fileSize
    ep.errorMessage = undefined
    ep.completedAt = undefined
    store.set(episodeKey(mediaId, episodeId), JSON.stringify(ep))
    notifyChange()
}

export function markDownloadCompleted(mediaId: number, episodeId: string, localFilePath: string, fileSize: number): void {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (!ep) return

    ep.status = "completed"
    ep.progress = 1
    ep.localFilePath = localFilePath
    ep.fileSize = fileSize
    ep.completedAt = Date.now()
    ep.errorMessage = undefined
    store.set(episodeKey(mediaId, episodeId), JSON.stringify(ep))

    // update anime info download count
    updateAnimeInfoDownloadCount(mediaId)

    notifyChange()
}

export function markDownloadFailed(mediaId: number, episodeId: string, errorMessage: string): void {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    if (!ep) return

    ep.status = "failed"
    ep.errorMessage = errorMessage
    store.set(episodeKey(mediaId, episodeId), JSON.stringify(ep))
    notifyChange()
}

export function getDownloadedEpisode(mediaId: number, episodeId: string): DownloadedEpisode | undefined {
    const raw = store.getString(episodeKey(mediaId, episodeId))
    if (!raw) return undefined
    try {
        const ep = JSON.parse(raw) as DownloadedEpisode
        const rawStatus = (ep as { status?: string }).status
        if (rawStatus === "stopped") {
            ep.status = "pending"
            ep.progress = 0
            ep.fileSize = 0
            ep.errorMessage = undefined
            ep.completedAt = undefined
        }
        // Re-resolve path so it survives iOS reinstalls
        ep.localFilePath = resolveLocalFilePath(ep.localFilePath)
        return ep
    }
    catch {
        return undefined
    }
}

export function isEpisodeDownloaded(mediaId: number, episodeId: string): boolean {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    return ep?.status === "completed"
}

export function getEpisodeDownloadStatus(mediaId: number, episodeId: string): DownloadStatus | null {
    const ep = getDownloadedEpisode(mediaId, episodeId)
    return ep?.status ?? null
}

export function getDownloadedEpisodesForMedia(mediaId: number): DownloadedEpisode[] {
    const episodeIds = readEpisodeIndex(mediaId)
    const episodes: DownloadedEpisode[] = []
    for (const epId of episodeIds) {
        const ep = getDownloadedEpisode(mediaId, epId)
        if (ep) episodes.push(ep)
    }
    // sort by type priority then episode number
    const typePriority: Record<string, number> = { main: 0, special: 1, nc: 2 }
    episodes.sort((a, b) => {
        const tp = (typePriority[a.type] ?? 3) - (typePriority[b.type] ?? 3)
        return tp !== 0 ? tp : a.episodeNumber - b.episodeNumber
    })
    return episodes
}

export function getCompletedEpisodesForMedia(mediaId: number): DownloadedEpisode[] {
    return getDownloadedEpisodesForMedia(mediaId).filter(ep => ep.status === "completed")
}

export function getActiveDownloads(): DownloadedEpisode[] {
    const mediaIds = readGlobalIndex()
    const active: DownloadedEpisode[] = []
    for (const mediaId of mediaIds) {
        const eps = getDownloadedEpisodesForMedia(mediaId)
        for (const ep of eps) {
            if (ep.status === "downloading" || ep.status === "pending") {
                active.push(ep)
            }
        }
    }
    return active
}

export function getFailedDownloads(): DownloadedEpisode[] {
    const mediaIds = readGlobalIndex()
    const failed: DownloadedEpisode[] = []
    for (const mediaId of mediaIds) {
        const eps = getDownloadedEpisodesForMedia(mediaId)
        for (const ep of eps) {
            if (ep.status === "failed") {
                failed.push(ep)
            }
        }
    }
    return failed
}

export function removeDownloadedEpisode(mediaId: number, episodeId: string): void {
    store.remove(episodeKey(mediaId, episodeId))

    const eps = readEpisodeIndex(mediaId).filter(id => id !== episodeId)
    writeEpisodeIndex(mediaId, eps)

    // if no more episodes for this media, remove from global index and anime info
    if (eps.length === 0) {
        const global = readGlobalIndex().filter(id => id !== mediaId)
        writeGlobalIndex(global)
        store.remove(animeInfoKey(mediaId))
        removeDownloadEntrySnapshot("anime", mediaId)
    } else {
        updateAnimeInfoDownloadCount(mediaId)
    }

    notifyChange()
}

export function removeAllAnimeDownloadsForMedia(mediaId: number): void {
    const epIds = readEpisodeIndex(mediaId)
    for (const epId of epIds) {
        store.remove(episodeKey(mediaId, epId))
    }
    store.remove(mediaIndexKey(mediaId))
    store.remove(animeInfoKey(mediaId))
    removeDownloadEntrySnapshot("anime", mediaId)

    const global = readGlobalIndex().filter(id => id !== mediaId)
    writeGlobalIndex(global)

    notifyChange()
}

export function clearAllAnimeDownloadRecords(): void {
    store.clearAll()
    notifyChange()
}

////////////////////////// Anime info tracking

export function saveAnimeInfo(info: DownloadedAnimeInfo): void {
    store.set(animeInfoKey(info.mediaId), JSON.stringify(info))
    notifyChange()
}

export function getAnimeInfo(mediaId: number): DownloadedAnimeInfo | undefined {
    const raw = store.getString(animeInfoKey(mediaId))
    if (!raw) return undefined
    try {
        return JSON.parse(raw) as DownloadedAnimeInfo
    }
    catch {
        return undefined
    }
}

export function getAllDownloadedAnime(): DownloadedAnimeInfo[] {
    const mediaIds = readGlobalIndex()
    const result: DownloadedAnimeInfo[] = []
    for (const id of mediaIds) {
        const info = getAnimeInfo(id)
        if (info && info.downloadedCount > 0) {
            result.push(info)
        }
    }
    return result
}

export function getDownloadedEpisodeCount(): number {
    const mediaIds = readGlobalIndex()
    let count = 0
    for (const id of mediaIds) {
        count += getCompletedEpisodesForMedia(id).length
    }
    return count
}

export function updateAnimeInfoDownloadCount(mediaId: number): void {
    const info = getAnimeInfo(mediaId)
    if (!info) return
    info.downloadedCount = getCompletedEpisodesForMedia(mediaId).length
    store.set(animeInfoKey(mediaId), JSON.stringify(info))
}

export function getDownloadedAnimeCount(): number {
    return getAllDownloadedAnime().length
}

export function getAnimeTotalDownloadSize(): number {
    const mediaIds = readGlobalIndex()
    let total = 0
    for (const mediaId of mediaIds) {
        const eps = getCompletedEpisodesForMedia(mediaId)
        for (const ep of eps) {
            total += ep.fileSize
        }
    }
    return total
}

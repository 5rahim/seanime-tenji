import type {
    Anime_Entry,
    DebridClient_FilePreview,
    HibikeTorrent_AnimeTorrent,
    Torrentstream_FilePreview,
} from "@/api/generated/types"

export type StreamFilePreview = Torrentstream_FilePreview | DebridClient_FilePreview

export function getFileSelectionValue(file: StreamFilePreview): string {
    return "fileId" in file ? file.fileId : String(file.index)
}

export function isSameTorrent(
    first: HibikeTorrent_AnimeTorrent | null | undefined,
    second: HibikeTorrent_AnimeTorrent | null | undefined,
): boolean {
    if (!first || !second) return false

    return first.infoHash === second.infoHash
        && first.downloadUrl === second.downloadUrl
}

export type TorrentConfirmAction = "none" | "pick-file" | "auto-stream" | "stream"

export function torrentConfirmAction(
    mode: "stream" | "download",
    torrent: HibikeTorrent_AnimeTorrent | null,
    autoFile: boolean,
): TorrentConfirmAction {
    if (mode === "download") return torrent?.isBatch ? "pick-file" : "none"
    if (!torrent) return "auto-stream"
    return torrent.isBatch && !autoFile ? "pick-file" : "stream"
}

export function canDownloadMissingEpisodes(entry: Anime_Entry): boolean {
    const missing = entry.downloadInfo?.episodesToDownload?.length ?? 0
    const total = entry.media?.episodes ?? 0

    return entry.media?.format !== "MOVIE"
        && entry.media?.status === "FINISHED"
        && total > 1
        && missing > 0
        && missing !== total
}

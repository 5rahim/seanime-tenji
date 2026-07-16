import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { EpisodeListItem } from "@/components/features/anime/episode-list-item"
import { EPISODE_PAGE_SIZE, EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { LuffyError } from "@/components/shared/luffy-error"
import { RowDivider } from "@/components/shared/row-divider"
import { SeaImage } from "@/components/shared/sea-image"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { usePaginatedItems } from "@/hooks/use-paginated-items"
import {
    type DownloadedEpisode,
    formatBytes,
    useCompletedEpisodesForMedia,
    useDeleteAllAnimeDownloadsForMedia,
    useDeleteAnimeDownload,
    useDownloadedEpisodesForMedia,
} from "@/lib/downloads"
import { usePlaybackCoordinator } from "@/lib/player"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { Ionicons } from "@expo/vector-icons"
import * as React from "react"
import { Alert, Pressable, Text, useWindowDimensions, View } from "react-native"

type AnimeEntryDownloadedViewProps = {
    entry: Anime_Entry
}

export function AnimeEntryDownloadedView({ entry }: AnimeEntryDownloadedViewProps) {
    const mediaId = entry.mediaId
    const allEpisodes = useDownloadedEpisodesForMedia(mediaId)
    const completedEpisodes = useCompletedEpisodesForMedia(mediaId)
    const { width: windowWidth } = useWindowDimensions()
    const downloadedThumbnailWidth = React.useMemo(
        () => Math.min(Math.max(windowWidth * 0.4, 128), 160),
        [windowWidth],
    )
    const inProgressEpisodes = React.useMemo(
        () => allEpisodes.filter(episode => episode.status === "downloading" || episode.status === "pending"),
        [allEpisodes],
    )
    const failedEpisodes = React.useMemo(
        () => allEpisodes.filter(episode => episode.status === "failed"),
        [allEpisodes],
    )
    const completedPagination = usePaginatedItems({
        items: completedEpisodes,
        pageSize: EPISODE_PAGE_SIZE,
        resetKey: mediaId,
    })
    const inProgressPagination = usePaginatedItems({
        items: inProgressEpisodes,
        pageSize: EPISODE_PAGE_SIZE,
        resetKey: mediaId,
    })
    const failedPagination = usePaginatedItems({
        items: failedEpisodes,
        pageSize: EPISODE_PAGE_SIZE,
        resetKey: mediaId,
    })
    const deleteDownload = useDeleteAnimeDownload()
    const deleteAll = useDeleteAllAnimeDownloadsForMedia()
    const { playFileSource } = usePlaybackCoordinator(entry)

    const totalSize = React.useMemo(() => {
        return completedEpisodes.reduce((acc, ep) => acc + ep.fileSize, 0)
    }, [completedEpisodes])

    if (allEpisodes.length === 0) {
        return (
            <LuffyError
                title="No downloads yet"
                description="Download episodes from the Library tab to watch them offline."
            />
        )
    }

    return (
        <View className="px-4 pt-4 gap-4">
            <View className="flex-row items-center justify-between px-1">
                <Text className="text-sm text-white/40">
                    {completedEpisodes.length} episode{completedEpisodes.length !== 1 ? "s" : ""} · {formatBytes(totalSize)}
                </Text>
                {completedEpisodes.length > 0 && (
                    <Pressable
                        onPress={() => {
                            Alert.alert(
                                "Delete all downloads",
                                `Remove all ${completedEpisodes.length} downloaded episode${completedEpisodes.length !== 1
                                    ? "s"
                                    : ""} for this anime?`,
                                [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                        text: "Delete",
                                        style: "destructive",
                                        onPress: () => deleteAll(mediaId),
                                    },
                                ],
                            )
                        }}
                    >
                        <Text className="text-sm text-red-400">Delete All</Text>
                    </Pressable>
                )}
            </View>

            {inProgressEpisodes.length > 0 && (
                <Surface variant="brand" className="overflow-hidden">
                    <View className="px-4 pt-3 pb-1">
                        <FormSectionLabel>Downloading ({inProgressEpisodes.length})</FormSectionLabel>
                    </View>

                    {inProgressPagination.hasMultiplePages && (
                        <View className="pb-2">
                            <EpisodePageSelector
                                totalCount={inProgressPagination.totalCount}
                                currentPage={inProgressPagination.page}
                                onPageChange={inProgressPagination.setPage}
                                logName="active anime downloads"
                            />
                        </View>
                    )}

                    {inProgressPagination.pagedItems.map((episode, idx) => (
                        <React.Fragment key={episode.aniDBEpisode}>
                            {idx > 0 && <RowDivider className="mx-3" />}
                            <InProgressEpisodeRow
                                episode={episode}
                                onDelete={() => deleteDownload(episode.mediaId, episode.aniDBEpisode)}
                            />
                        </React.Fragment>
                    ))}
                </Surface>
            )}

            {completedEpisodes.length > 0 && (
                <View className="gap-3">
                    <View className="px-1">
                        <Text className="text-xl font-bold text-foreground">Downloaded</Text>
                    </View>

                    {completedPagination.hasMultiplePages && (
                        <View className="-mx-4">
                            <EpisodePageSelector
                                totalCount={completedPagination.totalCount}
                                currentPage={completedPagination.page}
                                onPageChange={completedPagination.setPage}
                                logName="downloaded episodes"
                            />
                        </View>
                    )}

                    <View>
                        {completedPagination.pagedItems.map((episode, index) => (
                            <DownloadedEpisodeListItem
                                key={episode.aniDBEpisode}
                                episode={episode}
                                entry={entry}
                                thumbnailWidth={downloadedThumbnailWidth}
                                isFirst={index === 0}
                                isLast={index === completedPagination.pagedItems.length - 1}
                                onPlay={playFileSource}
                                onDelete={() => deleteDownload(episode.mediaId, episode.aniDBEpisode)}
                            />
                        ))}
                    </View>
                </View>
            )}

            {failedEpisodes.length > 0 && (
                <View className="gap-3">
                    <View className="px-1">
                        <Text className="text-xl font-bold text-foreground">Failed</Text>
                        <Text className="text-sm text-white/40 mt-1">
                            Remove failed downloads here, then retry from the Library tab.
                        </Text>
                    </View>

                    {failedPagination.hasMultiplePages && (
                        <View className="-mx-4">
                            <EpisodePageSelector
                                totalCount={failedPagination.totalCount}
                                currentPage={failedPagination.page}
                                onPageChange={failedPagination.setPage}
                                logName="failed anime downloads"
                            />
                        </View>
                    )}

                    <View>
                        {failedPagination.pagedItems.map((episode, index) => (
                            <DownloadedEpisodeListItem
                                key={episode.aniDBEpisode}
                                episode={episode}
                                entry={entry}
                                thumbnailWidth={downloadedThumbnailWidth}
                                isFirst={index === 0}
                                isLast={index === failedPagination.pagedItems.length - 1}
                                onPlay={playFileSource}
                                onDelete={() => deleteDownload(episode.mediaId, episode.aniDBEpisode)}
                            />
                        ))}
                    </View>
                </View>
            )}
        </View>
    )
}

function InProgressEpisodeRow({
    episode,
    onDelete,
}: {
    episode: DownloadedEpisode
    onDelete: () => void
}) {
    const { width: windowWidth } = useWindowDimensions()
    const thumbnailWidth = Math.min(Math.max(windowWidth * 0.3, 100), 130)
    const pct = Math.max(0, Math.min(100, Math.round((episode.progress ?? 0) * 100)))
    const isDownloading = episode.status === "downloading"
    const progressLabel = isDownloading
        ? (pct > 0 ? `${pct}% downloaded` : "Downloading")
        : "Waiting in queue"

    return (
        <View className="px-3 py-3 gap-2">
            <View className="flex-row items-center">
                <View
                    className="relative aspect-video rounded-lg overflow-hidden bg-muted flex-none mr-3"
                    style={{ width: thumbnailWidth }}
                >
                    <SeaImage
                        source={{ uri: episode.thumbnailUrl }}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                        transition={120}
                    />
                    <View className="absolute inset-0 items-center justify-center bg-black/45">
                        <Ionicons
                            name={isDownloading ? "cloud-download-outline" : "time-outline"}
                            size={24}
                            color={isDownloading ? "rgba(97,82,223,0.9)" : "rgba(255,255,255,0.65)"}
                        />
                    </View>
                </View>

                <View className="flex-1 mr-3">
                    <Text className="text-foreground font-bold text-sm" numberOfLines={1}>
                        {episode.type === "main"
                            ? `Episode ${episode.episodeNumber}`
                            : `${episode.type === "special" ? "Special" : "NC"} ${episode.episodeNumber}`}
                    </Text>
                    <Text className="text-white/70 text-sm mt-0.5" numberOfLines={1}>
                        {episode.episodeTitle || episode.displayTitle}
                    </Text>
                    <Text className="text-xs mt-1 text-white/40">
                        {progressLabel}
                    </Text>
                </View>

                <Pressable onPress={onDelete} hitSlop={8} className="p-2">
                    <Ionicons name="close" size={16} color="rgba(255,255,255,0.4)" />
                </Pressable>
            </View>

            {isDownloading && (
                <View className="h-1 rounded-full bg-white/10 overflow-hidden">
                    <View
                        className="h-full rounded-full bg-brand-300"
                        style={{ width: `${pct}%` }}
                    />
                </View>
            )}
        </View>
    )
}

////////////////////////// Episode row

type DownloadedEpisodeRowProps = {
    episode: DownloadedEpisode
    entry: Anime_Entry
    thumbnailWidth: number
    isFirst: boolean
    isLast: boolean
    onPlay: (source: MobilePlaybackSource) => Promise<void>
    onDelete: () => void
}

function createDownloadedAnimeEpisode(episode: DownloadedEpisode): Anime_Episode {
    return {
        type: episode.type,
        displayTitle: episode.displayTitle,
        episodeTitle: episode.episodeTitle,
        episodeNumber: episode.episodeNumber,
        aniDBEpisode: episode.aniDBEpisode,
        absoluteEpisodeNumber: episode.episodeNumber,
        progressNumber: episode.episodeNumber,
        isDownloaded: episode.status === "completed",
        isInvalid: false,
        _isNakamaEpisode: false,
        episodeMetadata: episode.thumbnailUrl ? { image: episode.thumbnailUrl } : undefined,
    }
}

function DownloadedEpisodeListItem({
    episode,
    entry,
    thumbnailWidth,
    isFirst,
    isLast,
    onPlay,
    onDelete,
}: DownloadedEpisodeRowProps) {
    const isCompleted = episode.status === "completed"
    const isFailed = episode.status === "failed"
    const matchingEpisode = React.useMemo(() => {
        return entry.episodes?.find(item => item.episodeNumber === episode.episodeNumber && item.type === episode.type) ?? null
    }, [entry.episodes, episode.episodeNumber, episode.type])
    const listEpisode = React.useMemo(
        () => matchingEpisode ?? createDownloadedAnimeEpisode(episode),
        [matchingEpisode, episode],
    )
    const isWatched = listEpisode.type === "main" && listEpisode.progressNumber <= (entry.listData?.progress ?? 0)

    const handlePlay = React.useCallback(() => {
        if (!isCompleted || !entry.media) return

        const source: MobilePlaybackSource = {
            id: `downloaded-${Date.now()}`,
            streamKind: "file",
            url: episode.localFilePath,
            mediaId: entry.media.id,
            episodeNumber: episode.episodeNumber,
            media: entry.media,
            episode: matchingEpisode ?? undefined,
            entryListData: entry.listData ?? undefined,
            localFile: matchingEpisode?.localFile,
            entryView: "downloaded",
            nextEpisodeAction: "local-file",
            continuityKind: "mediastream",
            episodes: entry.episodes ?? undefined,
        }

        onPlay(source)
    }, [isCompleted, entry, episode, matchingEpisode, onPlay])

    const handleLongPress = React.useCallback(() => {
        Alert.alert(
            episode.displayTitle,
            `${formatBytes(episode.fileSize)}`,
            [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: onDelete },
            ],
        )
    }, [episode, onDelete])

    const handleDeletePress = React.useCallback(() => {
        Alert.alert("Delete download?", "This episode will be removed from your device.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: onDelete },
        ])
    }, [onDelete])

    return (
        <EpisodeListItem
            episode={listEpisode}
            fallbackImage={entry.media?.bannerImage}
            onEpisodePress={isCompleted ? handlePlay : undefined}
            onEpisodeLongPress={isCompleted ? handleLongPress : undefined}
            isWatched={isCompleted && isWatched}
            thumbnailWidth={thumbnailWidth}
            isFirst={isFirst}
            isLast={isLast}
            rowPressable={isCompleted}
            disableDetailsButton={!matchingEpisode}
            imageOverride={episode.thumbnailUrl}
            watchedProgress={entry.listData?.progress ?? 0}
            hideMissingDescription
            descriptionOverride={isFailed ? null : undefined}
            footnoteText={isCompleted ? formatBytes(episode.fileSize) : (episode.errorMessage || "Download failed")}
            footnoteClassName={isCompleted ? "text-white/35" : "text-red-400"}
            thumbnailOverlay={isFailed ? (
                <View className="absolute inset-0 items-center justify-center bg-black/45">
                    <Ionicons name="warning-outline" size={24} color="rgba(239,68,68,0.9)" />
                </View>
            ) : undefined}
            action={(
                <Pressable
                    className="h-8 w-8 items-center justify-center rounded-full"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={handleDeletePress}
                >
                    <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.3)" />
                </Pressable>
            )}
        />
    )
}

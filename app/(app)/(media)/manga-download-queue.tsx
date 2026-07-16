import { ProfileSubpageHeader } from "@/components/features/profile/profile-menu"
import { EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { RowDivider } from "@/components/shared/row-divider"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { usePaginatedItems } from "@/hooks/use-paginated-items"
import {
    type DownloadedMangaChapter,
    getMangaInfo,
    isMangaChapterActive,
    useActiveMangaDownloads,
    useDeleteMangaChapterDownload,
    useDeleteMangaQueueItems,
    useFailedMangaDownloads,
    useResumeAllMangaDownloads,
    useRetryAllFailedMangaDownloads,
    useRetryMangaChapterDownload,
} from "@/lib/downloads"
import { Ionicons } from "@expo/vector-icons"
import { Image } from "expo-image"
import * as React from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const QUEUE_PAGE_SIZE = 30

export default function MangaDownloadQueueScreen() {
    const insets = useSafeAreaInsets()
    const activeDownloads = useActiveMangaDownloads()
    const failedDownloads = useFailedMangaDownloads()
    const deleteDownload = useDeleteMangaChapterDownload()
    const deleteQueueItems = useDeleteMangaQueueItems()
    const resumeAll = useResumeAllMangaDownloads()
    const retryDownload = useRetryMangaChapterDownload()
    const retryAll = useRetryAllFailedMangaDownloads()

    useIOSScrollRefreshRateWorkaround()

    const queuedDownloads = React.useMemo(() => {
        const priority: Record<string, number> = { downloading: 0, pending: 1 }
        return [...activeDownloads].sort((left, right) => {
            const leftPriority = priority[left.status] ?? 2
            const rightPriority = priority[right.status] ?? 2
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority
            }
            return left.startedAt - right.startedAt
        })
    }, [activeDownloads])

    const failedQueue = React.useMemo(
        () => [...failedDownloads].sort((left, right) => right.startedAt - left.startedAt),
        [failedDownloads],
    )
    const stalledQueuedDownloads = React.useMemo(
        () => queuedDownloads.filter(chapter => !isMangaChapterActive(chapter.mediaId, chapter.provider, chapter.chapterId)),
        [queuedDownloads],
    )
    const queuedDownloadsPagination = usePaginatedItems({
        items: queuedDownloads,
        pageSize: QUEUE_PAGE_SIZE,
    })
    const failedQueuePagination = usePaginatedItems({
        items: failedQueue,
        pageSize: QUEUE_PAGE_SIZE,
    })

    const handleClearQueue = React.useCallback(() => {
        if (queuedDownloads.length === 0) return

        Alert.alert(
            "Clear manga queue",
            `Remove ${queuedDownloads.length} queued item${queuedDownloads.length === 1 ? "" : "s"}? Active downloads will be cancelled.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear Queue",
                    style: "destructive",
                    onPress: () => deleteQueueItems(queuedDownloads),
                },
            ],
        )
    }, [deleteQueueItems, queuedDownloads])

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <ProfileSubpageHeader
                title="Manga Queue"
                detail="Track and manage current chapter downloads."
            />

            <ScrollView
                className="flex-1 bg-background"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
                contentInsetAdjustmentBehavior="automatic"
            >
                <Surface variant="muted" className="p-4 gap-3">
                    <FormSectionLabel>Overview</FormSectionLabel>

                    <QueueStatRow label="In queue" value={queuedDownloads.length} />
                    <QueueStatRow label="Failed" value={failedQueue.length} />
                </Surface>

                {queuedDownloads.length > 0 && (
                    <Surface variant="brand" className="overflow-hidden">
                        <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
                            <FormSectionLabel>In Queue ({queuedDownloads.length})</FormSectionLabel>
                            <View className="flex-row items-center gap-3">
                                {stalledQueuedDownloads.length > 0 ? (
                                    <Pressable onPress={() => resumeAll(stalledQueuedDownloads)} hitSlop={8}>
                                        <Text className="text-sm font-medium text-brand-200">Resume All</Text>
                                    </Pressable>
                                ) : null}
                                <Pressable onPress={handleClearQueue} hitSlop={8}>
                                    <Text className="text-sm font-medium text-red-300">Clear Queue</Text>
                                </Pressable>
                            </View>
                        </View>

                        {queuedDownloadsPagination.hasMultiplePages && (
                            <View className="pb-2">
                                <EpisodePageSelector
                                    totalCount={queuedDownloadsPagination.totalCount}
                                    pageSize={QUEUE_PAGE_SIZE}
                                    currentPage={queuedDownloadsPagination.page}
                                    onPageChange={queuedDownloadsPagination.setPage}
                                    logName="manga download queue"
                                />
                            </View>
                        )}

                        {queuedDownloadsPagination.pagedItems.map((chapter, index) => (
                            <React.Fragment key={`${chapter.mediaId}-${chapter.provider}-${chapter.chapterId}`}>
                                {index > 0 && <RowDivider />}
                                <MangaQueueRow
                                    chapter={chapter}
                                    onDelete={() => deleteDownload(chapter.mediaId, chapter.provider, chapter.chapterId)}
                                />
                            </React.Fragment>
                        ))}
                    </Surface>
                )}

                {failedQueue.length > 0 && (
                    <Surface variant="danger" className="overflow-hidden">
                        <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
                            <FormSectionLabel>Failed ({failedQueue.length})</FormSectionLabel>
                            <Pressable onPress={() => retryAll(failedQueue)} hitSlop={8}>
                                <Text className="text-sm font-medium text-red-300">Retry All</Text>
                            </Pressable>
                        </View>

                        {failedQueuePagination.hasMultiplePages && (
                            <View className="pb-2">
                                <EpisodePageSelector
                                    totalCount={failedQueuePagination.totalCount}
                                    pageSize={QUEUE_PAGE_SIZE}
                                    currentPage={failedQueuePagination.page}
                                    onPageChange={failedQueuePagination.setPage}
                                    logName="failed manga downloads"
                                />
                            </View>
                        )}

                        {failedQueuePagination.pagedItems.map((chapter, index) => (
                            <React.Fragment key={`${chapter.mediaId}-${chapter.provider}-${chapter.chapterId}-failed`}>
                                {index > 0 && <RowDivider />}
                                <MangaQueueRow
                                    chapter={chapter}
                                    onDelete={() => deleteDownload(chapter.mediaId, chapter.provider, chapter.chapterId)}
                                    onRetry={() => retryDownload(chapter)}
                                />
                            </React.Fragment>
                        ))}
                    </Surface>
                )}

                {queuedDownloads.length === 0 && failedQueue.length === 0 && (
                    <View className="items-center gap-3 py-20">
                        <Ionicons name="book-outline" size={40} color="rgba(255,255,255,0.2)" />
                        <Text className="text-sm text-white/40">No manga downloads in the queue</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    )
}

function QueueStatRow({ label, value }: { label: string; value: number }) {
    return (
        <View className="flex-row items-center justify-between">
            <Text className="text-sm text-white/70">{label}</Text>
            <Text className="text-sm font-medium text-foreground">{value}</Text>
        </View>
    )
}

function MangaQueueRow({
    chapter,
    onDelete,
    onRetry,
}: {
    chapter: DownloadedMangaChapter
    onDelete: () => void
    onRetry?: () => void
}) {
    const mangaInfo = getMangaInfo(chapter.mediaId)
    const progressPct = Math.max(0, Math.min(100, Math.round((chapter.progress ?? 0) * 100)))
    const isFailed = chapter.status === "failed"
    const isDownloading = chapter.status === "downloading"
    const isPending = chapter.status === "pending"
    const subtitle = isFailed
        ? chapter.errorMessage || "Download failed"
        : isDownloading
            ? `${chapter.pagesDownloaded}/${chapter.totalPages} pages · ${progressPct}%`
            : isPending
                ? "Waiting in queue"
                : `${chapter.totalPages} pages`

    return (
        <View className="px-4 py-3 gap-2">
            <View className="flex-row items-center">
                {mangaInfo?.coverImageUrl ? (
                    <Image
                        source={{ uri: mangaInfo.coverImageUrl }}
                        style={{ width: 44, height: 62, borderRadius: 8 }}
                        contentFit="cover"
                    />
                ) : (
                    <View className="h-[62px] w-11 items-center justify-center rounded-lg bg-white/10">
                        <Ionicons name="book-outline" size={18} color="rgba(255,255,255,0.3)" />
                    </View>
                )}

                <View className="ml-3 flex-1">
                    <Text className="text-xs text-white/35" numberOfLines={1}>
                        {mangaInfo?.title || `Manga #${chapter.mediaId}`}
                    </Text>
                    <Text className="mt-0.5 text-sm font-medium text-foreground" numberOfLines={1}>
                        Chapter {chapter.chapterNumber}
                    </Text>
                    <Text className="mt-0.5 text-xs text-white/55" numberOfLines={1}>
                        {chapter.title}
                    </Text>
                    {!!chapter.scanlator && (
                        <Text className="mt-0.5 text-xs text-white/35" numberOfLines={1}>
                            {chapter.scanlator}
                        </Text>
                    )}
                    <Text className={`mt-1 text-xs ${isFailed ? "text-red-300" : "text-white/40"}`} numberOfLines={2}>
                        {subtitle}
                    </Text>
                </View>

                <View className="ml-3 flex-row items-center gap-2">
                    {onRetry ? (
                        <QueueActionButton label="Retry" onPress={onRetry} tone="brand" />
                    ) : null}
                    <Pressable
                        onPress={onDelete}
                        hitSlop={8}
                        className="h-8 w-8 items-center justify-center rounded-lg bg-white/5"
                    >
                        <Ionicons name="close" size={16} color="rgba(255,255,255,0.5)" />
                    </Pressable>
                </View>
            </View>

            {isDownloading && (
                <View className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <View className="h-full rounded-full bg-brand-300" style={{ width: `${progressPct}%` }} />
                </View>
            )}
        </View>
    )
}

function QueueActionButton({
    label,
    onPress,
    tone,
}: {
    label: string
    onPress: () => void
    tone: "brand" | "danger"
}) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            className={`rounded-lg px-3 py-2 ${tone === "brand" ? "bg-brand-300/15" : "bg-red-500/15"}`}
        >
            <Text className={`text-xs font-medium ${tone === "brand" ? "text-brand-200" : "text-red-300"}`}>{label}</Text>
        </Pressable>
    )
}

import { AL_BaseManga } from "@/api/generated/types"
import { formatMangaReaderHref } from "@/components/features/manga/reader/manga-reader-utils"
import { LuffyError } from "@/components/shared/luffy-error"
import { RowDivider } from "@/components/shared/row-divider"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { usePaginatedItems } from "@/hooks/use-paginated-items"
import {
    type DownloadedMangaChapter,
    formatBytes,
    useAllDownloadedMangaChapters,
    useDeleteAllMangaDownloadsForMedia,
    useDeleteMangaChapterDownload,
} from "@/lib/downloads"
import { getMangaDownloadDiskUsage } from "@/lib/downloads/manga-download-manager"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import * as React from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { MangaPaginationControls } from "./manga-pagination-controls"

const PAGE_SIZE = 30
const IN_PROGRESS_PAGE_SIZE = 30

type MangaEntryDownloadedViewProps = {
    media: AL_BaseManga
}

export function MangaEntryDownloadedView({ media }: MangaEntryDownloadedViewProps) {
    const router = useRouter()
    const mediaId = media.id
    const allChapters = useAllDownloadedMangaChapters(mediaId)
    const deleteChapter = useDeleteMangaChapterDownload()
    const deleteAll = useDeleteAllMangaDownloadsForMedia()

    const completedChapters = React.useMemo(() => allChapters.filter(ch => ch.status === "completed"),
        [allChapters])

    const inProgressChapters = React.useMemo(() => allChapters.filter(ch => ch.status === "downloading" || ch.status === "pending"),
        [allChapters])

    const completedPagination = usePaginatedItems({
        items: completedChapters,
        pageSize: PAGE_SIZE,
        resetKey: mediaId,
    })
    const inProgressPagination = usePaginatedItems({
        items: inProgressChapters,
        pageSize: IN_PROGRESS_PAGE_SIZE,
        resetKey: mediaId,
    })

    const diskBytes = React.useMemo(() => getMangaDownloadDiskUsage(), [allChapters])

    if (allChapters.length === 0) {
        return (
            <LuffyError
                title="No downloads yet"
                description="Download chapters from the Chapters tab to read them offline."
            />
        )
    }

    return (
        <View className="px-4 pt-4 gap-4">
            <View className="flex-row items-center justify-between px-1">
                <Text className="text-sm text-white/40">
                    {completedChapters.length} chapter{completedChapters.length !== 1 ? "s" : ""} · {formatBytes(diskBytes)}
                </Text>
                {completedChapters.length > 0 && (
                    <Pressable
                        onPress={() => {
                            Alert.alert(
                                "Delete all downloads",
                                `Remove all ${completedChapters.length} downloaded chapter${completedChapters.length !== 1
                                    ? "s"
                                    : ""} for this manga?`,
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

            {inProgressChapters.length > 0 && (
                <Surface variant="brand" className="overflow-hidden">
                    <View className="px-4 pt-3 pb-1">
                        <FormSectionLabel>Downloading ({inProgressChapters.length})</FormSectionLabel>
                    </View>

                    {inProgressPagination.hasMultiplePages && (
                        <View className="px-4 pb-2">
                            <MangaPaginationControls
                                page={inProgressPagination.page}
                                totalPages={inProgressPagination.totalPages}
                                onPageChange={inProgressPagination.setPage}
                                logName="active manga downloads"
                            />
                        </View>
                    )}

                    {inProgressPagination.pagedItems.map((ch, idx) => (
                        <React.Fragment key={`${ch.provider}-${ch.chapterId}`}>
                            {idx > 0 && <RowDivider className="mx-3" />}
                            <InProgressChapterRow
                                chapter={ch}
                                onDelete={() => deleteChapter(ch.mediaId, ch.provider, ch.chapterId)}
                            />
                        </React.Fragment>
                    ))}

                    {inProgressPagination.hasMultiplePages && (
                        <View className="px-4 pt-2 pb-3">
                            <MangaPaginationControls
                                page={inProgressPagination.page}
                                totalPages={inProgressPagination.totalPages}
                                onPageChange={inProgressPagination.setPage}
                                logName="active manga downloads"
                            />
                        </View>
                    )}
                </Surface>
            )}

            {completedChapters.length > 0 && (
                <>
                    {completedPagination.hasMultiplePages && (
                        <MangaPaginationControls
                            page={completedPagination.page}
                            totalPages={completedPagination.totalPages}
                            onPageChange={completedPagination.setPage}
                            logName="downloaded manga chapters"
                        />
                    )}

                    <Surface className="overflow-hidden">
                        {completedPagination.pagedItems.map((ch, idx) => (
                            <React.Fragment key={`${ch.provider}-${ch.chapterId}`}>
                                {idx > 0 && <RowDivider className="mx-3" />}
                                <DownloadedChapterRow
                                    chapter={ch}
                                    onRead={() => {
                                        router.push(formatMangaReaderHref({
                                            mediaId: ch.mediaId,
                                            provider: ch.provider,
                                            chapterId: ch.chapterId,
                                            chapterNumber: ch.chapterNumber,
                                        }))
                                    }}
                                    onDelete={() => {
                                        Alert.alert(
                                            "Delete chapter",
                                            `Remove Chapter ${ch.chapterNumber} from your device?`,
                                            [
                                                { text: "Cancel", style: "cancel" },
                                                {
                                                    text: "Delete",
                                                    style: "destructive",
                                                    onPress: () => deleteChapter(ch.mediaId, ch.provider, ch.chapterId),
                                                },
                                            ],
                                        )
                                    }}
                                />
                            </React.Fragment>
                        ))}
                    </Surface>

                    {completedPagination.hasMultiplePages && (
                        <MangaPaginationControls
                            page={completedPagination.page}
                            totalPages={completedPagination.totalPages}
                            onPageChange={completedPagination.setPage}
                            logName="downloaded manga chapters"
                        />
                    )}
                </>
            )}
        </View>
    )
}

function InProgressChapterRow({
    chapter,
    onDelete,
}: {
    chapter: DownloadedMangaChapter
    onDelete: () => void
}) {
    const pct = Math.max(0, Math.min(100, Math.round((chapter.progress ?? 0) * 100)))
    const isDownloading = chapter.status === "downloading"
    const subtitle = isDownloading
        ? `${chapter.pagesDownloaded}/${chapter.totalPages} pages · ${pct}%`
        : "Waiting in queue"

    return (
        <View className="px-4 py-3 gap-2">
            <View className="flex-row items-center">
                <View className="flex-1 mr-3">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {chapter.title || `Chapter ${chapter.chapterNumber}`}
                    </Text>
                    <Text className="text-xs text-white/40 mt-0.5">
                        {subtitle}
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

////////////////////////// Completed chapter row

function DownloadedChapterRow({
    chapter,
    onRead,
    onDelete,
}: {
    chapter: DownloadedMangaChapter
    onRead: () => void
    onDelete: () => void
}) {
    return (
        <Pressable
            className="flex-row items-center p-3"
            onPress={onRead}
            onLongPress={onDelete}
        >

            <View className="w-11 h-11 rounded-xl bg-white/5 items-center justify-center flex-none mr-3">
                <Text className="text-sm font-bold text-white" numberOfLines={1}>
                    {chapter.chapterNumber}
                </Text>
            </View>


            <View className="flex-1">
                <Text className="text-foreground font-medium text-sm" numberOfLines={1}>
                    {chapter.title || `Chapter ${chapter.chapterNumber}`}
                </Text>
                <View className="flex-row items-center gap-2 mt-0.5">
                    <Text className="text-white/35 text-xs">{chapter.totalPages} pages</Text>
                    {!!chapter.scanlator && (
                        <Text className="text-white/35 text-xs" numberOfLines={1}>· {chapter.scanlator}</Text>
                    )}
                </View>
            </View>


            <Pressable
                className="ml-2 p-2"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={onDelete}
            >
                <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.3)" />
            </Pressable>
        </Pressable>
    )
}

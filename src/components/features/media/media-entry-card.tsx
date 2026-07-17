import {
    AL_BaseAnime,
    AL_BaseManga,
    Anime_EntryLibraryData,
    Anime_EntryListData,
    Anime_NakamaEntryLibraryData,
    Manga_EntryListData,
} from "@/api/generated/types"
import { useGetMangaLatestChapterNumbersMap } from "@/api/hooks/manga.hooks"
import { useAnimeLibraryEntryDataValue, useMediaEntryListDataValue } from "@/atoms/anilist-collection.atoms"
import { useServerStatus } from "@/atoms/server.atoms"
import { MediaEntryQuickInfoSheet } from "@/components/features/media/media-entry-quick-info-sheet"
import { SeaImage } from "@/components/shared/sea-image"
import { getMangaEntryLatestChapterNumber, useStoredMangaSelectionState } from "@/hooks/use-manga-chapters"
import { Ionicons } from "@/lib/icons/Ionicons"
import { cn } from "@/lib/utils"
import React from "react"
import { Pressable, Text, View } from "react-native"
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated"
import { MediaEntryScore } from "./media-entry-score"

function audienceScoreColor(score: number): string {
    if (score < 60) return "#fca5a5"  // red-300
    if (score < 70) return "#fde68a"  // amber-200
    if (score < 82) return "#86efac"  // green-300
    return "#a5b4fc"                  // indigo-300
}

function getCurrentAnimeEpisodeCount(media: AL_BaseAnime) {
    const nextAiringEpisode = media.nextAiringEpisode?.episode
    if (nextAiringEpisode) {
        return Math.max(0, nextAiringEpisode - 1)
    }

    return media.episodes ?? 0
}

function CardProgressBadgeContainer({
    topContent,
    progress,
    total,
    cardWidth,
}: {
    topContent?: React.ReactNode
    progress?: number
    total?: number | null
    cardWidth: number
}) {
    const hasProgress = typeof progress === "number" && progress > 0

    if (!topContent && !hasProgress) return null

    return (
        <View className={cn("absolute left-0 top-0")}>
            <View className="rounded-br-lg bg-gray-900/85 px-2 py-1.5">
                {topContent ? (
                    <View className={cn("flex-row items-center gap-1", hasProgress && "mb-0.5")}>
                        {topContent}
                    </View>
                ) : null}
                {hasProgress ? (
                    <Text
                        className={cn(
                            "font-extrabold text-white",
                            cardWidth < 150 ? "text-sm" : "text-base",
                        )}
                    >
                        {progress}
                        <Text
                            className={cn(
                                "text-muted-foreground",
                                cardWidth < 150 ? "text-sm" : "text-base",
                            )}
                        >
                            /{total || "-"}
                        </Text>
                    </Text>
                ) : null}
            </View>
        </View>
    )
}

function AnimeEntryCardProgressBadge({
    media,
    listData,
    libraryData,
    nakamaLibraryData,
    cardWidth,
    showUnwatched,
}: {
    media: AL_BaseAnime
    listData?: Anime_EntryListData
    libraryData?: Anime_EntryLibraryData
    nakamaLibraryData?: Anime_NakamaEntryLibraryData
    cardWidth: number
    showUnwatched: boolean
}) {
    const progress = listData?.progress ?? 0
    const isInLibrary = !!nakamaLibraryData?.mainFileCount || !!libraryData?.mainFileCount
    const unwatchedFromLibrary = nakamaLibraryData?.unwatchedCount ?? libraryData?.unwatchedCount ?? 0
    const unwatchedFromStreaming = Math.max(0, getCurrentAnimeEpisodeCount(media) - progress)
    const unwatchedCount = isInLibrary ? unwatchedFromLibrary : unwatchedFromStreaming
    const shouldShowUnwatchedCount = showUnwatched
        && (listData?.status === "CURRENT" || listData?.status === "REPEATING")
        && unwatchedCount > 0

    const topContent = shouldShowUnwatchedCount ? (
        <>
            <Ionicons name="play-circle-outline" size={11} color="rgba(255,255,255,0.85)" />
            <Text className="text-xs font-semibold text-white/85">{unwatchedCount}</Text>
        </>
    ) : undefined

    return (
        <CardProgressBadgeContainer
            topContent={topContent}
            progress={listData?.progress}
            total={media.episodes}
            cardWidth={cardWidth}
        />
    )
}

function MangaEntryCardProgressBadge({
    media,
    listData,
    cardWidth,
}: {
    media: AL_BaseManga
    listData?: Manga_EntryListData
    cardWidth: number
}) {
    const { data: latestChapterNumbers } = useGetMangaLatestChapterNumbersMap()
    const { storedProviders, storedFilters } = useStoredMangaSelectionState()

    const unreadCount = React.useMemo(() => {
        const latestChapterNumber = getMangaEntryLatestChapterNumber(
            media.id,
            latestChapterNumbers,
            storedProviders,
            storedFilters,
        )

        if (!latestChapterNumber) return 0

        return Math.max(0, latestChapterNumber - (listData?.progress ?? 0))
    }, [latestChapterNumbers, listData?.progress, media.id, storedFilters, storedProviders])

    const topContent = unreadCount > 0 ? (
        <>
            <Ionicons name="book-outline" size={10} color="white" />
            <Text className="text-xs font-semibold text-white/85">{unreadCount}</Text>
        </>
    ) : undefined

    return (
        <CardProgressBadgeContainer
            topContent={topContent}
            progress={listData?.progress}
            total={media.chapters}
            cardWidth={cardWidth}
        />
    )
}

function AnimeLibraryBadge({ fileCount }: { fileCount?: number }) {
    if (!fileCount || fileCount <= 0) return null

    return (
        <View className="absolute right-0 top-0 z-10 h-7 w-7 items-center justify-center rounded-bl-lg bg-orange-300">
            <Ionicons name="library" size={15} color="rgb(67,20,7)" />
        </View>
    )
}

function AdultContentVeil() {
    return (
        <View className="absolute inset-0 items-center justify-center bg-black/45">

        </View>
    )
}


type MediaEntryCardProps<T extends "anime" | "manga"> = {
    type: T
    media: T extends "anime" ? AL_BaseAnime : AL_BaseManga
    listData?: T extends "anime" ? Anime_EntryListData : T extends "manga" ? Manga_EntryListData : never
    libraryData?: T extends "anime" ? Anime_EntryLibraryData : never
    nakamaLibraryData?: T extends "anime" ? Anime_NakamaEntryLibraryData : never
    cardWidth: number
    showAudienceScore?: boolean
    overlay?: React.ReactNode
    hideProgress?: boolean
    onPress?: () => void
    preferFetchedSheetMedia?: boolean
    hideLibraryBadge?: boolean
}

export function MediaEntryCard<T extends "anime" | "manga">(props: MediaEntryCardProps<T>) {

    const {
        type,
        media,
        listData: _listData,
        libraryData: _libraryData,
        nakamaLibraryData: _nakamaLibraryData,
        cardWidth,
        onPress: _onPress,
        showAudienceScore: _showAudienceScore,
        overlay,
        hideProgress,
        preferFetchedSheetMedia,
        hideLibraryBadge,
    } = props

    const serverStatus = useServerStatus()
    const hideScore = !!serverStatus?.settings?.anilist?.hideAudienceScore
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const showUnwatched = serverStatus?.themeSettings?.showAnimeUnwatchedCount ?? true
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const syncedListData = useMediaEntryListDataValue(type, media.id)
    const syncedLibraryEntryData = useAnimeLibraryEntryDataValue(media.id)
    const listData = (syncedListData ?? _listData) as Anime_EntryListData | Manga_EntryListData | undefined
    const libraryData = (syncedLibraryEntryData?.libraryData ?? _libraryData) as Anime_EntryLibraryData | undefined
    const nakamaLibraryData = (syncedLibraryEntryData?.nakamaLibraryData ?? _nakamaLibraryData) as Anime_NakamaEntryLibraryData | undefined

    const scale = useSharedValue(1)
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }))

    function onPressIn() {
        scale.set(withSpring(0.95, { damping: 50, stiffness: 400 }))
    }

    function onPressOut() {
        scale.set(withSpring(1, { damping: 50, stiffness: 400 }))
    }

    function onPress() {
        _onPress?.()
    }

    function onLongPress() {
        scale.set(withSpring(1, { damping: 50, stiffness: 400 }))
        setSheetOpen(true)
    }

    const showAudienceScore = hideScore ? false : _showAudienceScore
    const blurAdultContent = blurAdult && !!media.isAdult
    const posterHeight = cardWidth * (cardWidth < 150 ? 1.305 : 1.275)
    const showAnimeLibraryBadge = type === "anime" && !!libraryData && !hideLibraryBadge
    const animeLibraryFileCount = showAnimeLibraryBadge ? libraryData?.mainFileCount : undefined

    return (
        <>
            <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} onLongPress={onLongPress} delayLongPress={350}>
                <Animated.View
                    className="flex flex-col relative mb-2"
                    style={[
                        {
                            width: cardWidth,
                            height: cardWidth * 1.5,
                        },
                        animatedStyle,
                    ]}
                >
                    {overlay}
                    <View
                        className="relative mb-2 w-full overflow-hidden rounded-xl"
                        style={{ height: posterHeight }}
                    >
                        <SeaImage
                            source={{ uri: media.coverImage?.large || media.coverImage?.extraLarge || "" }}
                            cachePolicy="memory-disk"
                            contentFit="cover"
                            transition={0}
                            blurRadius={blurAdultContent ? 18 : 0}
                            style={{ width: "100%", height: "100%" }}
                        />

                        {blurAdultContent ? <AdultContentVeil /> : null}

                        {!hideProgress && (type === "anime" ? (
                            <AnimeEntryCardProgressBadge
                                media={media as AL_BaseAnime}
                                listData={listData as Anime_EntryListData | undefined}
                                libraryData={libraryData as Anime_EntryLibraryData | undefined}
                                nakamaLibraryData={nakamaLibraryData as Anime_NakamaEntryLibraryData | undefined}
                                cardWidth={cardWidth}
                                showUnwatched={showUnwatched}
                            />
                        ) : (
                            <MangaEntryCardProgressBadge
                                media={media as AL_BaseManga}
                                listData={listData as Manga_EntryListData | undefined}
                                cardWidth={cardWidth}
                            />
                        ))}

                        {!!listData?.score && <View className="absolute right-0 bottom-0">
                            <MediaEntryScore score={listData?.score} />
                        </View>}

                        {!!media.meanScore && showAudienceScore && (
                            <View className="absolute bottom-0 left-0 flex-row items-center gap-1 rounded-tr-lg bg-black/70 px-1.5 py-1">
                                <Ionicons name="heart" size={9} color={audienceScoreColor(media.meanScore)} />
                                <Text className="text-xs font-bold" style={{ color: audienceScoreColor(media.meanScore) }}>
                                    {(media.meanScore / 10).toFixed(1)}
                                </Text>
                            </View>
                        )}

                        {showAnimeLibraryBadge ? <AnimeLibraryBadge fileCount={animeLibraryFileCount} /> : null}
                    </View>

                    <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        className={cn(
                            "text-lg text-foreground font-semibold mb-1",
                            { "text-sm": cardWidth < 150 },
                        )}
                    >
                        {media.title?.userPreferred}
                    </Text>
                </Animated.View>
            </Pressable>

            {sheetOpen ? (
                <MediaEntryQuickInfoSheet
                    type={type}
                    media={media as any}
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    preferFetchedMedia={preferFetchedSheetMedia}
                />
            ) : null}
        </>
    )
}

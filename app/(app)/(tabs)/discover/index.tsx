import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import {
    DiscoverHeroCarouselBackdrop,
    DiscoverHeroCarouselInteractionLayer,
    HERO_HEIGHT,
    useDiscoverHeroCarouselController,
    useDiscoverHeroItems,
} from "@/components/features/discover/discover-hero-carousel"
import {
    getCurrentSeasonLabel,
    getPreviousSeasonLabel,
    useDiscoverCurrentSeasonAnime,
    useDiscoverMissedSequels,
    useDiscoverPastSeasonAnime,
    useDiscoverRecentlyAired,
    useDiscoverTrendingAnime,
    useDiscoverTrendingManga,
    useDiscoverTrendingMovies,
    useDiscoverUpcomingAnime,
} from "@/components/features/discover/discover-queries"
import { HorizontalMediaCardList } from "@/components/features/media/horizontal-media-card-list"
import { SafeView } from "@/components/layout/layout-view"
import { TabFadeView } from "@/components/layout/tab-fade-view"
import { MediaGenreSelector } from "@/components/shared/media-genre-selector"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { Skeleton } from "@/components/ui/skeleton"
import { COLORS } from "@/constants/colors"
import { useDevScreenProfiler } from "@/hooks/use-dev-screen-profiler"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { useIsServerConnected } from "@/lib/offline"
import { getHorizontalMediaCardRowHeight, getHorizontalMediaCardWidth } from "@/lib/responsive-card-layout"
import { SEARCH_MEDIA_GENRES } from "@/lib/search/search-constants"
import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useIsFocused } from "@react-navigation/native"
import { router } from "expo-router"
import * as React from "react"
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View, ViewToken } from "react-native"
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated"

type DiscoverMode = "anime" | "manga"

const DISCOVER_SECTION_HEADER_HEIGHT = 56
const DISCOVER_ANIME_SECTION_ITEMS = [
    { key: "trending" },
    { key: "aired-recently" },
    { key: "current-season" },
    { key: "past-season" },
    { key: "upcoming" },
    { key: "movies" },
    { key: "missed" },
] as const
const DISCOVER_ANIME_SECTION_INDEX = Object.fromEntries(
    DISCOVER_ANIME_SECTION_ITEMS.map((item, index) => [item.key, index]),
) as Record<DiscoverAnimeSectionItem["key"], number>
const DISCOVER_MANGA_SECTION_ITEMS = [
    { key: "jp" },
    { key: "kr" },
    { key: "cn" },
] as const

type DiscoverAnimeSectionItem = (typeof DISCOVER_ANIME_SECTION_ITEMS)[number]
type DiscoverMangaSectionItem = (typeof DISCOVER_MANGA_SECTION_ITEMS)[number]

export default function DiscoverScreen() {
    const isConnected = useIsServerConnected()
    const isFocused = useIsFocused()
    const [mode, setMode] = React.useState<DiscoverMode>("anime")
    const [selectedTrendingGenre, setSelectedTrendingGenre] = React.useState<string | null>(null)
    const scrollY = useSharedValue(0)

    useIOSScrollRefreshRateWorkaround()

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (e) => {
            "worklet"
            scrollY.value = e.contentOffset.y
        },
    })
    const { media: heroMedia, isLoading: heroLoading } = useDiscoverHeroMedia(mode)
    const heroController = useDiscoverHeroCarouselController(heroMedia, isFocused)

    useDevScreenProfiler(`discover:${mode}`, heroMedia.length > 0 || !heroLoading)

    if (!isConnected) {
        return (
            <SafeView>
                <TabFadeView>
                    <OfflineBanner />
                    <View className="flex-1 items-center justify-center px-8">
                        <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.2)" />
                        <Text className="text-white/30 text-sm mt-3 text-center">
                            Connect to your server to discover content
                        </Text>
                    </View>
                </TabFadeView>
            </SafeView>
        )
    }

    return (
        <View className="flex-1 bg-background">
            <TabFadeView>
                {heroMedia.length > 0 && (
                    <DiscoverHeroCarouselBackdrop
                        media={heroMedia}
                        currentIndex={heroController.currentIndex}
                        screenWidth={heroController.screenWidth}
                        scrollX={heroController.scrollX}
                        scrollY={scrollY}
                    />
                )}

                {mode === "anime" ? (
                    <DiscoverAnimeSections
                        heroMedia={heroMedia}
                        heroLoading={heroLoading}
                        heroController={heroController}
                        scrollHandler={scrollHandler}
                        selectedTrendingGenre={selectedTrendingGenre}
                        onChangeTrendingGenre={setSelectedTrendingGenre}
                        onChangeMode={setMode}
                    />
                ) : (
                    <DiscoverMangaSections
                        heroMedia={heroMedia}
                        heroLoading={heroLoading}
                        heroController={heroController}
                        scrollHandler={scrollHandler}
                        onChangeMode={setMode}
                    />
                )}
            </TabFadeView>
        </View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Mode toggle (anime/manga)
///////////////////////////////////////////////////////////////////////////////

export function DiscoverModeToggle({
    mode,
    onChangeMode,
}: {
    mode: DiscoverMode
    onChangeMode: (mode: DiscoverMode) => void
}) {
    return (
        <View className="mb-2 flex-row self-center rounded-xl p-0.5">
            <TogglePill
                label="Anime"
                isActive={mode === "anime"}
                onPress={() => onChangeMode("anime")}
            />
            <TogglePill
                label="Manga"
                isActive={mode === "manga"}
                onPress={() => onChangeMode("manga")}
            />
        </View>
    )
}

function TogglePill({
    label,
    isActive,
    onPress,
}: {
    label: string
    isActive: boolean
    onPress: () => void
}) {
    return (
        <View className="overflow-hidden rounded-xl">
            <Pressable
                onPress={onPress}
                android_ripple={{ color: "rgba(255,255,255,0.1)" }}
            >
                <View className={cn("px-6 py-2", isActive ? "bg-white/15" : "bg-transparent")}>
                    <Text className={cn("text-sm font-medium text-white/45", isActive && "font-bold text-white")}>
                        {label}
                    </Text>
                </View>
            </Pressable>
        </View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Search row
///////////////////////////////////////////////////////////////////////////////

function DiscoverSearchRow({ type }: { type: DiscoverMode }) {
    return (
        <View className="">
            <Pressable
                onPress={() => router.push(`/(app)/(tabs)/discover/search?type=${type}`)}
                className="rounded-2xl px-3 active:opacity-75"
            >
                <Ionicons name="search-outline" size={24} color="rgba(255,255,255,0.35)" />
            </Pressable>
        </View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// Hero data
///////////////////////////////////////////////////////////////////////////////

function useDiscoverHeroMedia(mode: DiscoverMode) {
    const { data: trendingAnime, isLoading: animeLoading } = useDiscoverTrendingAnime(mode === "anime")
    const { data: trendingMangaJP, isLoading: mangaLoading } = useDiscoverTrendingManga("JP", mode === "manga")
    const animeMedia = useDiscoverHeroItems(trendingAnime?.Page?.media?.filter(Boolean) ?? [])
    const mangaMedia = useDiscoverHeroItems(trendingMangaJP?.Page?.media?.filter(Boolean) ?? [])

    if (mode === "anime") {
        return { media: animeMedia, isLoading: animeLoading }
    }

    return { media: mangaMedia, isLoading: mangaLoading }
}

function HeroSkeleton() {
    return (
        <View
            style={{
                height: HERO_HEIGHT,
                backgroundColor: COLORS.surface,
                justifyContent: "flex-end",
                paddingHorizontal: 20,
                paddingBottom: 20,
            }}
        >
            <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" />
        </View>
    )
}

function useDiscoverSectionActivation(sectionCount: number) {
    const [highestActivatedIndex, setHighestActivatedIndex] = React.useState(() => Math.min(sectionCount - 1, 1))
    const sectionCountRef = React.useRef(sectionCount)
    const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 15 }).current

    React.useEffect(() => {
        sectionCountRef.current = sectionCount
        setHighestActivatedIndex(Math.min(sectionCount - 1, 1))
    }, [sectionCount])

    const onViewableItemsChanged = React.useRef(({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
        let highestVisibleIndex = -1

        for (const item of viewableItems) {
            if (typeof item.index === "number" && item.index > highestVisibleIndex) {
                highestVisibleIndex = item.index
            }
        }

        if (highestVisibleIndex < 0) return

        setHighestActivatedIndex(prev => {
            const next = Math.min(sectionCountRef.current - 1, highestVisibleIndex + 1)
            return next > prev ? next : prev
        })
    }).current

    const isSectionActivated = React.useCallback(
        (index: number) => index <= highestActivatedIndex,
        [highestActivatedIndex],
    )

    return { isSectionActivated, onViewableItemsChanged, viewabilityConfig }
}

function DiscoverListHeader({
    mode,
    heroMedia,
    heroLoading,
    heroController,
    onChangeMode,
}: {
    mode: DiscoverMode
    heroMedia: Array<AL_BaseAnime | AL_BaseManga>
    heroLoading: boolean
    heroController: ReturnType<typeof useDiscoverHeroCarouselController>
    onChangeMode: (mode: DiscoverMode) => void
}) {
    return (
        <>
            {heroMedia.length > 0 ? (
                <DiscoverHeroCarouselInteractionLayer media={heroMedia} type={mode} controller={heroController} />
            ) : heroLoading ? (
                <HeroSkeleton />
            ) : null}

            <View className="flex-row items-center justify-between px-3.5">
                <View className="pt-1">
                    <DiscoverModeToggle mode={mode} onChangeMode={onChangeMode} />
                </View>

                <DiscoverSearchRow type={mode} />
            </View>
        </>
    )
}

function DiscoverSectionSkeleton({ title }: { title: string }) {
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const cardRowHeight = React.useMemo(() => getHorizontalMediaCardRowHeight(cardWidth), [cardWidth])
    const skeletonCount = React.useMemo(() => Math.min(6, Math.ceil(screenWidth / (cardWidth + 10))), [cardWidth, screenWidth])

    return (
        <View className="flex flex-col gap-4">
            <View
                className="flex-row items-center justify-between px-4"
                style={{ height: DISCOVER_SECTION_HEADER_HEIGHT }}
            >
                <Skeleton className="h-6 w-40 rounded-lg bg-white/10" />
                <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
            </View>

            <View style={{ height: cardRowHeight }}>
                <View className="flex-row px-5" style={{ gap: 10 }}>
                    {Array.from({ length: skeletonCount }, (_, index) => (
                        <View key={`${title}-${index}`} style={{ width: cardWidth }} className="gap-3">
                            <View style={{ width: cardWidth, height: cardWidth * 1.5 }}>
                                <Skeleton className="h-full w-full rounded-xl bg-white/10" />
                            </View>
                            <View style={{ width: cardWidth * 0.82, height: 12 }}>
                                <Skeleton className="h-full w-full rounded-full bg-white/10" />
                            </View>
                            <View style={{ width: cardWidth * 0.56, height: 12 }}>
                                <Skeleton className="h-full w-full rounded-full bg-white/10" />
                            </View>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    )
}

function DiscoverHorizontalSection({
    enabled,
    isLoading,
    title,
    type,
    media,
    onMediaPress,
    sectionIndex,
    showAudienceScore,
    hideCount,
}: {
    enabled: boolean
    isLoading: boolean
    title: string
    type: DiscoverMode
    media: (AL_BaseAnime | AL_BaseManga)[]
    onMediaPress: (media: AL_BaseAnime | AL_BaseManga) => void
    sectionIndex: number
    showAudienceScore?: boolean
    hideCount?: boolean
}) {
    if (!enabled || isLoading) {
        return <DiscoverSectionSkeleton title={title} />
    }

    if (media.length === 0) {
        return null
    }

    return (
        <HorizontalMediaCardList
            title={title}
            type={type}
            sectionIndex={sectionIndex}
            media={media as never}
            onMediaPress={onMediaPress as never}
            showAudienceScore={showAudienceScore}
            hideCount={hideCount}
        />
    )
}

///////////////////////////////////////////////////////////////////////////////
// Anime sections
///////////////////////////////////////////////////////////////////////////////

function DiscoverAnimeSections({
    heroMedia,
    heroLoading,
    heroController,
    scrollHandler,
    selectedTrendingGenre,
    onChangeTrendingGenre,
    onChangeMode,
}: {
    heroMedia: Array<AL_BaseAnime | AL_BaseManga>
    heroLoading: boolean
    heroController: ReturnType<typeof useDiscoverHeroCarouselController>
    scrollHandler: ReturnType<typeof useAnimatedScrollHandler>
    selectedTrendingGenre: string | null
    onChangeTrendingGenre: (genre: string | null) => void
    onChangeMode: (mode: DiscoverMode) => void
}) {
    const { isSectionActivated, onViewableItemsChanged, viewabilityConfig } = useDiscoverSectionActivation(DISCOVER_ANIME_SECTION_ITEMS.length)
    const trendingEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX.trending)
    const recentlyAiredEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX["aired-recently"])
    const currentSeasonEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX["current-season"])
    const pastSeasonEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX["past-season"])
    const upcomingEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX.upcoming)
    const moviesEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX.movies)
    const missedEnabled = isSectionActivated(DISCOVER_ANIME_SECTION_INDEX.missed)

    const { data: trending, isLoading: trendingLoading } = useDiscoverTrendingAnime(
        trendingEnabled,
        selectedTrendingGenre ? [selectedTrendingGenre] : undefined,
    )
    const { data: currentSeason, isLoading: currentSeasonLoading } = useDiscoverCurrentSeasonAnime(currentSeasonEnabled)
    const { media: recentlyAiredMedia, isLoading: recentlyAiredLoading } = useDiscoverRecentlyAired(recentlyAiredEnabled)
    const { data: pastSeason, isLoading: pastSeasonLoading } = useDiscoverPastSeasonAnime(pastSeasonEnabled)
    const { data: missedSequels, isLoading: missedLoading } = useDiscoverMissedSequels(missedEnabled)
    const { data: upcoming, isLoading: upcomingLoading } = useDiscoverUpcomingAnime(upcomingEnabled)
    const { data: movies, isLoading: moviesLoading } = useDiscoverTrendingMovies(moviesEnabled)

    const trendingMedia = trending?.Page?.media?.filter(Boolean) ?? []
    const currentSeasonMedia = currentSeason?.Page?.media?.filter(Boolean) ?? []
    const pastSeasonMedia = pastSeason?.Page?.media?.filter(Boolean) ?? []
    const missedMedia = missedSequels ?? []
    const upcomingMedia = upcoming?.Page?.media?.filter(Boolean) ?? []
    const moviesMedia = movies?.Page?.media?.filter(Boolean) ?? []
    const trendingGenreOptions = React.useMemo(
        () => [
            { label: "All", value: null },
            ...SEARCH_MEDIA_GENRES.map(genre => ({ label: genre, value: genre })),
        ],
        [],
    )
    const listHeader = React.useMemo(() => (
        <DiscoverListHeader
            mode="anime"
            heroMedia={heroMedia}
            heroLoading={heroLoading}
            heroController={heroController}
            onChangeMode={onChangeMode}
        />
    ), [heroController, heroLoading, heroMedia, onChangeMode])
    const keyExtractor = React.useCallback((item: DiscoverAnimeSectionItem) => item.key, [])
    const renderSectionItem = React.useCallback(({ item }: { item: DiscoverAnimeSectionItem }) => {
            switch (item.key) {
                case "trending":
                    return (
                        <View>
                            <MediaGenreSelector
                                options={trendingGenreOptions}
                                value={selectedTrendingGenre}
                                onChange={onChangeTrendingGenre}
                            />
                            <DiscoverHorizontalSection
                                title="Trending Right Now"
                                type="anime"
                                enabled={trendingEnabled}
                                isLoading={trendingLoading}
                                sectionIndex={DISCOVER_ANIME_SECTION_INDEX.trending}
                                media={trendingMedia}
                                onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                                showAudienceScore
                                hideCount
                            />
                        </View>
                    )
                case "current-season":
                    return (
                        <DiscoverHorizontalSection
                            title={`Top of ${getCurrentSeasonLabel()}`}
                            type="anime"
                            enabled={currentSeasonEnabled}
                            isLoading={currentSeasonLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX["current-season"]}
                            media={currentSeasonMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
                case "aired-recently":
                    return (
                        <DiscoverHorizontalSection
                            title="Aired Recently"
                            type="anime"
                            enabled={recentlyAiredEnabled}
                            isLoading={recentlyAiredLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX["aired-recently"]}
                            media={recentlyAiredMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
                case "past-season":
                    return (
                        <DiscoverHorizontalSection
                            title={`Best of ${getPreviousSeasonLabel()}`}
                            type="anime"
                            enabled={pastSeasonEnabled}
                            isLoading={pastSeasonLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX["past-season"]}
                            media={pastSeasonMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
                case "upcoming":
                    return (
                        <DiscoverHorizontalSection
                            title="Coming Soon"
                            type="anime"
                            enabled={upcomingEnabled}
                            isLoading={upcomingLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX.upcoming}
                            media={upcomingMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
                case "movies":
                    return (
                        <DiscoverHorizontalSection
                            title="Trending Movies"
                            type="anime"
                            enabled={moviesEnabled}
                            isLoading={moviesLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX.movies}
                            media={moviesMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
                case "missed":
                    return (
                        <DiscoverHorizontalSection
                            title="You Might Have Missed"
                            type="anime"
                            enabled={missedEnabled}
                            isLoading={missedLoading}
                            sectionIndex={DISCOVER_ANIME_SECTION_INDEX.missed}
                            media={missedMedia}
                            onMediaPress={(m) => router.push(`/(app)/entry/anime/${m.id}`)}
                            showAudienceScore
                            hideCount
                        />
                    )
            }
        },
        [currentSeasonEnabled, currentSeasonLoading, currentSeasonMedia, missedEnabled, missedLoading, missedMedia, moviesEnabled, moviesLoading,
            moviesMedia, onChangeTrendingGenre, pastSeasonEnabled, pastSeasonLoading, pastSeasonMedia, selectedTrendingGenre, trendingEnabled,
            trendingGenreOptions, trendingLoading, trendingMedia, upcomingEnabled, upcomingLoading, upcomingMedia, recentlyAiredEnabled,
            recentlyAiredLoading, recentlyAiredMedia])

    return (
        <Animated.FlatList
            data={DISCOVER_ANIME_SECTION_ITEMS}
            keyExtractor={keyExtractor}
            renderItem={renderSectionItem}
            ListHeaderComponent={listHeader}
            onScroll={scrollHandler}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            updateCellsBatchingPeriod={16}
            windowSize={5}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: 100 }}
        />
    )
}

///////////////////////////////////////////////////////////////////////////////
// Manga sections
///////////////////////////////////////////////////////////////////////////////

function DiscoverMangaSections({
    heroMedia,
    heroLoading,
    heroController,
    scrollHandler,
    onChangeMode,
}: {
    heroMedia: Array<AL_BaseAnime | AL_BaseManga>
    heroLoading: boolean
    heroController: ReturnType<typeof useDiscoverHeroCarouselController>
    scrollHandler: ReturnType<typeof useAnimatedScrollHandler>
    onChangeMode: (mode: DiscoverMode) => void
}) {
    const { isSectionActivated, onViewableItemsChanged, viewabilityConfig } = useDiscoverSectionActivation(DISCOVER_MANGA_SECTION_ITEMS.length)
    const jpEnabled = isSectionActivated(0)
    const krEnabled = isSectionActivated(1)
    const cnEnabled = isSectionActivated(2)

    const { data: mangaJP, isLoading: mangaJPLoading } = useDiscoverTrendingManga("JP", jpEnabled)
    const { data: manhwaKR, isLoading: manhwaKRLoading } = useDiscoverTrendingManga("KR", krEnabled)
    const { data: manhuaCN, isLoading: manhuaCNLoading } = useDiscoverTrendingManga("CN", cnEnabled)

    const jpMedia = mangaJP?.Page?.media?.filter(Boolean) ?? []
    const krMedia = manhwaKR?.Page?.media?.filter(Boolean) ?? []
    const cnMedia = manhuaCN?.Page?.media?.filter(Boolean) ?? []
    const listHeader = React.useMemo(() => (
        <DiscoverListHeader
            mode="manga"
            heroMedia={heroMedia}
            heroLoading={heroLoading}
            heroController={heroController}
            onChangeMode={onChangeMode}
        />
    ), [heroController, heroLoading, heroMedia, onChangeMode])
    const keyExtractor = React.useCallback((item: DiscoverMangaSectionItem) => item.key, [])
    const renderSectionItem = React.useCallback(({ item }: { item: DiscoverMangaSectionItem }) => {
        switch (item.key) {
            case "jp":
                return (
                    <DiscoverHorizontalSection
                        title="Trending Manga"
                        type="manga"
                        enabled={jpEnabled}
                        isLoading={mangaJPLoading}
                        sectionIndex={0}
                        media={jpMedia}
                        onMediaPress={(m) => router.push(`/(app)/entry/manga/${m.id}`)}
                    />
                )
            case "kr":
                return (
                    <DiscoverHorizontalSection
                        title="Trending Manhwa"
                        type="manga"
                        enabled={krEnabled}
                        isLoading={manhwaKRLoading}
                        sectionIndex={1}
                        media={krMedia}
                        onMediaPress={(m) => router.push(`/(app)/entry/manga/${m.id}`)}
                    />
                )
            case "cn":
                return (
                    <DiscoverHorizontalSection
                        title="Trending Manhua"
                        type="manga"
                        enabled={cnEnabled}
                        isLoading={manhuaCNLoading}
                        sectionIndex={2}
                        media={cnMedia}
                        onMediaPress={(m) => router.push(`/(app)/entry/manga/${m.id}`)}
                    />
                )
        }
    }, [cnEnabled, cnMedia, jpEnabled, jpMedia, krEnabled, krMedia, manhuaCNLoading, manhwaKRLoading, mangaJPLoading])

    return (
        <Animated.FlatList
            data={DISCOVER_MANGA_SECTION_ITEMS}
            keyExtractor={keyExtractor}
            renderItem={renderSectionItem}
            ListHeaderComponent={listHeader}
            onScroll={scrollHandler}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            updateCellsBatchingPeriod={16}
            windowSize={5}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: 100 }}
        />
    )
}

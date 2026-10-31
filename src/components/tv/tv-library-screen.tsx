import type { AL_BaseAnime } from "@/api/generated/types"
import { getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { animeEntryPlaybackIntentAtom, createAnimeEntryPlaybackIntent } from "@/atoms/anime-entry.atoms"
import { useServerStatus } from "@/atoms/server.atoms"
import {
    TV,
    TVButton,
    TVContinueCard,
    TVHeroCarousel,
    type TVHeroItem,
    TVInput,
    TVMediaGrid,
    TVPageSkeleton,
    TVSectionHeader,
    TVShelf,
    tvSize,
} from "@/components/tv"
import type { TVMediaMeta } from "@/components/tv/tv-shelf"
import { ContinueWatchingItem, useAnimeLibraryCollection } from "@/hooks/use-anime-library-collection"
import { getContinueWatchingSpoilerActive, getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { Ionicons } from "@/lib/icons/Ionicons"
import { cleanHtml, mediaTitle } from "@/lib/media-metadata"
import { getServerLocalEpisodeCount, parseServerLocalAnimeEntry, useIsServerConnected, useServerLocalAnimeRecords } from "@/lib/offline"
import { filterEntriesByTitle } from "@/lib/utils/filtering"
import { router, useFocusEffect, useIsFocused } from "expo-router"
import { useSetAtom } from "jotai"
import * as React from "react"
import { FlatList, ScrollView, Text, TVFocusGuideView, View } from "react-native"
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated"

type Shelf = {
    key: string
    title: string
    media: AL_BaseAnime[]
    badgeById?: ReadonlyMap<number, string>
    metaById?: ReadonlyMap<number, TVMediaMeta>
    hideLibraryBadge?: boolean
    hideProgress?: boolean
    onMediaPress?: (media: AL_BaseAnime) => void
}

const LABELS: Record<string, string> = {
    CURRENT: "Currently watching",
    PAUSED: "Paused",
    PLANNING: "Planning",
    COMPLETED: "Completed",
    DROPPED: "Dropped",
}

export function TVLibraryScreen() {
    const serverStatus = useServerStatus()
    const isConnected = useIsServerConnected()
    const isFocused = useIsFocused()
    const setPlaybackIntent = useSetAtom(animeEntryPlaybackIntentAtom)
    const localRecords = useServerLocalAnimeRecords()
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const [search, setSearch] = React.useState("")
    const deferredSearch = React.useDeferredValue(search)
    const scrollY = useSharedValue(0)
    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y
        },
    })
    const searchSlideDistance = tvSize(20)
    const searchAnimatedStyle = useAnimatedStyle(() => {
        const opacity = interpolate(scrollY.value, [0, 80], [1, 0], Extrapolation.CLAMP)
        const translateY = interpolate(scrollY.value, [0, 80], [0, -searchSlideDistance], Extrapolation.CLAMP)
        return { opacity, transform: [{ translateY }] }
    })
    const {
        libraryCollectionList,
        continueWatchingList,
        isLoading,
        refetch,
        hasNonLocalEpisodes,
    } = useAnimeLibraryCollection()

    const allEntries = React.useMemo(() => libraryCollectionList.flatMap(list => list?.entries ?? []), [libraryCollectionList])
    const searchMedia = React.useMemo(() => {
        if (!deferredSearch.trim()) return []
        return filterEntriesByTitle(allEntries, deferredSearch).map(item => item.media).filter((media): media is AL_BaseAnime => !!media)
    }, [allEntries, deferredSearch])
    const searching = search.trim().length > 0

    useFocusEffect(React.useCallback(() => {
        if (isConnected) refetch()
    }, [isConnected, refetch]))

    const shelves = React.useMemo<Shelf[]>(() => {
        const items: Shelf[] = []

        for (const list of libraryCollectionList) {
            const media = list?.entries?.map(entry => entry.media).filter(Boolean) as AL_BaseAnime[] ?? []
            if (!list?.type || media.length === 0) continue
            items.push({
                key: list.type,
                title: LABELS[list.type] ?? list.type,
                media,
                hideLibraryBadge: list.type !== "CURRENT" || !hasNonLocalEpisodes,
            })
        }

        const localMedia: AL_BaseAnime[] = []
        const localBadges = new Map<number, string>()
        const localMeta = new Map<number, TVMediaMeta>()
        for (const record of localRecords) {
            const entry = parseServerLocalAnimeEntry(record)
            if (!entry?.media) continue
            localMedia.push(entry.media)
            localBadges.set(record.mediaId, `Server · ${getServerLocalEpisodeCount(record)}`)
            localMeta.set(record.mediaId, {
                listData: entry.listData,
                libraryData: entry.libraryData,
                nakamaLibraryData: entry.nakamaLibraryData,
            })
        }
        if (localMedia.length > 0) {
            items.push({
                key: "server-local",
                title: "On Seanime Server",
                media: localMedia,
                badgeById: localBadges,
                metaById: localMeta,
                hideLibraryBadge: true,
                onMediaPress: media => router.push({
                    pathname: "/(app)/entry/anime/[id]",
                    params: { id: String(media.id), initialView: "server-local" },
                }),
            })
        }

        return items
    }, [hasNonLocalEpisodes, libraryCollectionList, localRecords])

    const openMedia = React.useCallback((id: number) => {
        router.push(`/(app)/entry/anime/${id}`)
    }, [])

    const openContinue = React.useCallback((item: ContinueWatchingItem) => {
        const episode = item.episode
        const mediaId = episode.baseAnime?.id
        if (!mediaId) return

        if (item.sourceView === "library" && episode.localFile?.path) {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "play-local-episode",
                mediaId,
                episodeNumber: episode.episodeNumber,
            }))
        }

        router.push({
            pathname: "/(app)/entry/anime/[id]",
            params: {
                id: String(mediaId),
                initialView: item.sourceView,
            },
        })
    }, [setPlaybackIntent])

    const heroItems = React.useMemo<TVHeroItem[]>(() => {
        const spoilerActive = getContinueWatchingSpoilerActive(serverStatus)

        return continueWatchingList
            .filter(item => !!item.episode.baseAnime)
            .slice(0, 12)
            .map(item => {
                const episode = item.episode
                const media = episode.baseAnime!
                const spoiler = getEpisodeSpoilerState(serverStatus, {
                    episodeNumber: episode.progressNumber || episode.episodeNumber,
                    spoilerActive,
                })
                return {
                    key: `${media.id}-${episode.progressNumber}`,
                    image: spoiler.hideThumbnail
                        ? getSpoilerSafeAnimeImage(media)
                        : media.bannerImage
                        ?? episode.episodeMetadata?.image
                        ?? media.coverImage?.extraLarge
                        ?? media.coverImage?.large,
                    kicker: "Continue watching",
                    title: mediaTitle(media),
                    subtitle: `${episode.displayTitle}${!spoiler.hideTitle && episode.episodeTitle ? `  ·  ${episode.episodeTitle}` : ""}`,
                    meta: [
                        media.seasonYear,
                        media.format?.replaceAll("_", " "),
                        media.genres?.slice(0, 3).join("  ·  "),
                    ].filter(Boolean).join("  ·  "),
                    description: cleanHtml(media.description),
                    score: media.meanScore,
                    progressPercent: getEpisodePercentageComplete(
                        watchHistory,
                        media.id,
                        episode.progressNumber,
                    ),
                    actionLabel: `Play ${episode.displayTitle}`,
                    onAction: () => openContinue(item),
                    secondaryLabel: "View details",
                    onSecondary: () => openMedia(media.id),
                }
            })
    }, [continueWatchingList, openContinue, openMedia, serverStatus, watchHistory])

    const renderContinue = React.useCallback(({ item, index }: { item: ContinueWatchingItem; index: number }) => (
        <TVContinueCard
            item={item}
            preferred={index === 0}
            progressPercent={item.episode.baseAnime?.id
                ? getEpisodePercentageComplete(watchHistory, item.episode.baseAnime.id, item.episode.progressNumber)
                : 0}
            onPress={() => openContinue(item)}
        />
    ), [openContinue, watchHistory])

    if (isLoading && isConnected) {
        return <TVPageSkeleton hero />
    }

    if (!shelves.length && !continueWatchingList.length && !searching) {
        return (
            <ScrollView style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
                <View
                    style={{
                        flex: 1,
                        minHeight: tvSize(360),
                        alignItems: "center",
                        justifyContent: "center",
                        gap: tvSize(8),
                        paddingHorizontal: TV.gutter,
                        paddingTop: tvSize(100),
                    }}
                >
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(30) }}>
                        {isConnected ? "Your anime library is empty" : "Server is offline"}
                    </Text>
                    <Text className="text-white/45" style={{ fontSize: tvSize(20) }}>
                        {isConnected ? "Use Discover to find something to watch." : "Reconnect to load your library."}
                    </Text>
                    <View style={{ marginTop: tvSize(20) }}>
                        <TVButton
                            label={isConnected ? "Open Discover" : "Open Settings"}
                            variant="primary"
                            hasTVPreferredFocus
                            onPress={() => router.navigate((isConnected ? "/(app)/(tabs)/discover" : "/(app)/(tabs)/(profile)") as never)}
                        />
                    </View>
                </View>
            </ScrollView>
        )
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            {isConnected ? (
                <Animated.View
                    pointerEvents="box-none"
                    style={[{
                        position: "absolute",
                        top: TV.navTop,
                        left: TV.gutter,
                        width: tvSize(480),
                        zIndex: 210,
                    }, searchAnimatedStyle]}
                >
                    <TVInput
                        value={search}
                        onChangeText={setSearch}
                        placeholder="Search your anime library"
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                        preferred={heroItems.length === 0}
                        floating
                        containerStyle={{ borderRadius: tvSize(99) }}
                        icon={(
                            <Ionicons
                                name="search"
                                size={tvSize(22)}
                                color="rgba(255,255,255,0.58)"
                            />
                        )}
                    />
                </Animated.View>
            ) : null}

            {searching ? (
                <TVMediaGrid
                    media={searchMedia}
                    query={search}
                    topInset={TV.navInset}
                    emptyText="Try another title from your AniList library."
                />
            ) : (
                <Animated.ScrollView
                    style={{ flex: 1 }}
                    fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                    contentContainerStyle={{
                        paddingBottom: tvSize(90),
                        gap: TV.sectionGap,
                    }}
                    showsVerticalScrollIndicator={false}
                    onScroll={scrollHandler}
                    scrollEventThrottle={16}
                >
                    <View style={{ gap: tvSize(34), paddingBottom: tvSize(8) }}>
                        <View
                            style={{
                                minHeight: heroItems.length > 0 || isLoading ? tvSize(560) : tvSize(32),
                            }}
                        >
                            <TVHeroCarousel items={heroItems} active={isFocused} preferred loading={isLoading} />
                        </View>

                        {continueWatchingList.length > 0 ? (
                            <View style={{ gap: tvSize(12) }}>
                                <TVSectionHeader
                                    title="Continue watching"
                                    count={continueWatchingList.length}
                                />
                                <TVFocusGuideView trapFocusLeft trapFocusRight>
                                    <FlatList
                                        horizontal
                                        data={continueWatchingList}
                                        renderItem={renderContinue}
                                        keyExtractor={(item,
                                            index,
                                        ) => item.episode.localFile?.path || `${item.episode.baseAnime?.id ?? "episode"}-${item.episode.type}-${item.episode.episodeNumber}-${index}`}
                                        snapToAlignment="item"
                                        snapToItemPadding={TV.gutter}
                                        style={{ flexGrow: 0, overflow: "visible" }}
                                        contentContainerStyle={{
                                            paddingHorizontal: TV.gutter,
                                            paddingTop: tvSize(10),
                                            paddingBottom: tvSize(14),
                                            gap: TV.cardGap,
                                        }}
                                        showsHorizontalScrollIndicator={false}
                                        removeClippedSubviews={false}
                                        initialNumToRender={6}
                                        maxToRenderPerBatch={6}
                                        windowSize={5}
                                    />
                                </TVFocusGuideView>
                            </View>
                        ) : null}
                    </View>

                    {shelves.map((shelf, index) => (
                        <TVShelf
                            key={shelf.key}
                            title={shelf.title}
                            media={shelf.media}
                            badgeById={shelf.badgeById}
                            metaById={shelf.metaById}
                            hideLibraryBadge={shelf.hideLibraryBadge}
                            hideProgress={shelf.hideProgress}
                            onMediaPress={shelf.onMediaPress}
                            first={heroItems.length === 0 && index === 0}
                        />
                    ))}
                </Animated.ScrollView>
            )}
        </View>
    )
}

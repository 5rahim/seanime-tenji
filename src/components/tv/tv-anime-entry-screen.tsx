import { requestTVFocus } from "@/components/tv/tv-native"
import type {
    Anime_Episode,
    AL_AnimeDetailsById_Media_Characters_Edges,
    AL_AnimeDetailsById_Media_Relations_Edges,
    AL_BaseAnime,
} from "@/api/generated/types"
import { getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { tvReturnFocusAtom } from "@/atoms/anime-entry.atoms"
import {
    TVButton,
    useTVFocus,
    TV,
    tvSize,
    TVEpisodeCard,
    TVEpisodeGrid,
    TVEpisodePlayButton,
    TVShelf,
    TVEditAnilistEntryDrawer,
    TVPillButton,
    TVScoreBadge,
} from "@/components/tv"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { ScrollView, Text, View, Animated, Pressable, FlatList, TVFocusGuideView } from "react-native"
import { useAnimeEntryScreen } from "@/components/features/media/anime-entry-screen-context"
import { useIsServerConnected, useServerConnectionState, useServerLocalAnimeEntry, useServerLocalIdentity } from "@/lib/offline"
import { usePlaybackCoordinator } from "@/lib/player"
import { useServerStatus } from "@/atoms/server.atoms"
import { AnimeEntryTorrentStreamSection } from "@/components/features/torrentstream/anime-entry-torrent-stream-section"
import { AnimeEntryOnlinestreamSection } from "@/components/features/onlinestream/anime-entry-onlinestream-section"
import { OfflineBanner } from "@/components/shared/offline-banner"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useGetAnilistAnimeDetails } from "@/api/hooks/anilist.hooks"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import type { AnimeEntryView } from "@/components/features/media/anime-entry-view-switcher"
import { tvEntryView } from "@/components/features/media/anime-entry-view-utils"
import { getEpisodeSpoilerState } from "@/lib/anime-spoilers"
import { altTitle, cleanHtml, listStatus, mediaTitle, startLabel } from "@/lib/media-metadata"
import { router, useFocusEffect } from "expo-router"
import { useAtom } from "jotai/react"

type Props = {
    initialView?: AnimeEntryView
    currentView?: AnimeEntryView
    onViewChange?: (view: AnimeEntryView) => void
}

type FocusNode = React.ElementRef<typeof Pressable>

export function TVAnimeEntryScreen({
    initialView = "library",
    currentView,
    onViewChange,
}: Props) {
    const { entry } = useAnimeEntryScreen()
    const serverStatus = useServerStatus()
    const connectionState = useServerConnectionState()
    const isConnected = useIsServerConnected()
    const isOffline = connectionState === "disconnected"
    const serverLocalIdentity = useServerLocalIdentity()
    const serverLocalEntry = useServerLocalAnimeEntry(entry.mediaId)
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const [localView, setLocalView] = React.useState<AnimeEntryView>(() => tvEntryView(initialView))
    const [editOpen, setEditOpen] = React.useState(false)
    const [returnFocus, setReturnFocus] = useAtom(tvReturnFocusAtom)
    const episodeRefs = React.useRef(new Map<string, FocusNode>())
    const tabRef = React.useRef<FocusNode>(null)
    const editRef = React.useRef<FocusNode>(null)
    const playRef = React.useRef<FocusNode>(null)

    const activeView = tvEntryView(currentView ?? localView)
    const setActiveView = React.useCallback((view: AnimeEntryView) => {
        const next = tvEntryView(view)
        if (onViewChange) {
            onViewChange(next)
            return
        }
        setLocalView(next)
    }, [onViewChange])

    const { playLocalFileEpisode, playServerLocalFileEpisode } = usePlaybackCoordinator(entry)

    const setEpisodeRef = React.useCallback((
        view: "library" | "server-local",
        episode: number,
        node: FocusNode | null,
    ) => {
        const key = `${view}:${episode}`
        if (node) {
            episodeRefs.current.set(key, node)
        } else {
            episodeRefs.current.delete(key)
        }
    }, [])

    const { mainEpisodes, specialEpisodes, ncEpisodes, unwatchedMainEpisodes, progress } = React.useMemo(() => {
        if (!entry?.episodes) {
            return {
                mainEpisodes: [] as Anime_Episode[],
                specialEpisodes: [] as Anime_Episode[],
                ncEpisodes: [] as Anime_Episode[],
                unwatchedMainEpisodes: [] as Anime_Episode[],
                progress: 0,
            }
        }

        const main = entry.episodes.filter(episode => episode.type === "main")
        const special = entry.episodes.filter(episode => episode.type === "special")
        const nc = entry.episodes.filter(episode => episode.type === "nc")
        const currentProgress = entry.listData?.progress || 0

        return {
            mainEpisodes: main,
            specialEpisodes: special,
            ncEpisodes: nc,
            unwatchedMainEpisodes: main.filter(episode => episode.progressNumber > currentProgress).slice(0, 15),
            progress: currentProgress,
        }
    }, [entry?.episodes, entry?.listData?.progress])

    const mainEpisodesInitialPage = React.useMemo(() => {
        if (progress > 0) {
            const firstUnwatchedIndex = mainEpisodes.findIndex(ep => ep.progressNumber > progress)
            if (firstUnwatchedIndex > 0) {
                return Math.floor(firstUnwatchedIndex / 24)
            }
        }
        return 0
    }, [mainEpisodes, progress])

    const serverGroups = React.useMemo(() => {
        const episodes = serverLocalEntry?.episodes ?? []
        const watched = serverLocalEntry?.listData?.progress ?? 0
        const main = episodes.filter(episode => episode.type === "main")

        return {
            main,
            special: episodes.filter(episode => episode.type === "special"),
            nc: episodes.filter(episode => episode.type === "nc"),
            unwatched: main.filter(episode => episode.progressNumber > watched).slice(0, 15),
            progress: watched,
        }
    }, [serverLocalEntry])

    const serverMainInitialPage = React.useMemo(() => {
        const first = serverGroups.main.findIndex(episode => episode.progressNumber > serverGroups.progress)
        return first > 0 ? Math.floor(first / 24) : 0
    }, [serverGroups.main, serverGroups.progress])

    const cardProps = React.useCallback((
        item: Anime_Episode,
        watchedProgress = progress,
        fallbackImage = entry.media?.bannerImage,
    ) => {
        const spoiler = getEpisodeSpoilerState(serverStatus, {
            episodeNumber: item.progressNumber || item.episodeNumber,
            watchedProgress,
        })
        const completed = item.type === "main" && item.progressNumber <= watchedProgress
        return {
            image: item.episodeMetadata?.image ?? fallbackImage,
            duration: item.episodeMetadata?.length,
            badge: item.displayTitle,
            title: spoiler.hideTitle
                ? `Episode ${item.episodeNumber}`
                : item.episodeTitle || `Episode ${item.episodeNumber}`,
            subtitle: spoiler.hideTitle ? undefined : item.localFile?.name,
            progressPercent: getEpisodePercentageComplete(watchHistory, entry.mediaId, item.progressNumber),
            completed,
            filler: item.episodeMetadata?.isFiller,
            blurred: spoiler.hideThumbnail || (!!serverStatus?.settings?.anilist?.blurAdultContent && !!entry.media?.isAdult),
        }
    }, [entry.media?.bannerImage, entry.media?.isAdult, entry.mediaId, progress, serverStatus, watchHistory])

    const renderEpisode = React.useCallback((item: Anime_Episode, index: number) => {
        const props = cardProps(item)
        return (
            <TVEpisodeCard
                ref={node => setEpisodeRef("library", item.episodeNumber, node)}
                key={item.localFile?.path || `${item.type}-${item.episodeNumber}-${index}`}
                {...props}
                onPress={() => playLocalFileEpisode(item)}
                recyclingKey={item.localFile?.path || `tv-episode-${item.episodeNumber}-${index}`}
            />
        )
    }, [cardProps, playLocalFileEpisode, setEpisodeRef])

    const renderServerEpisode = React.useCallback((item: Anime_Episode, index: number) => {
        const props = cardProps(
            item,
            serverGroups.progress,
            serverLocalEntry?.media?.bannerImage ?? entry.media?.bannerImage,
        )
        return (
            <TVEpisodeCard
                ref={node => setEpisodeRef("server-local", item.episodeNumber, node)}
                key={item.localFile?.path || `server-${item.type}-${item.episodeNumber}-${index}`}
                {...props}
                onPress={() => void playServerLocalFileEpisode(item, serverLocalEntry)}
                recyclingKey={item.localFile?.path || `tv-server-episode-${item.episodeNumber}-${index}`}
            />
        )
    }, [cardProps, entry.media?.bannerImage, playServerLocalFileEpisode, serverGroups.progress, serverLocalEntry, setEpisodeRef])

    const nextEpisodeToPlay = unwatchedMainEpisodes[0] || mainEpisodes[0]
    const serverNextEpisode = serverGroups.unwatched[0] || serverGroups.main[0]

    const heroImage = entry.media?.bannerImage
        ?? entry.media?.coverImage?.extraLarge
        ?? entry.media?.coverImage?.large
    const coverImage = entry.media?.coverImage?.extraLarge
        ?? entry.media?.coverImage?.large
    const heroTitle = mediaTitle(entry.media)
    const heroAltTitle = altTitle(entry.media)
    const heroDescription = cleanHtml(entry.media?.description)
    const date = startLabel(entry.media)
    const heroMeta = [
        date,
        entry.media?.season?.replaceAll("_", " "),
        entry.media?.status?.replaceAll("_", " "),
        entry.media?.format?.replaceAll("_", " "),
        entry.media?.genres?.slice(0, 3).join("  ·  "),
    ].filter(Boolean).join("  ·  ")
    const progressLabel = `${entry.listData?.progress ?? 0}/${entry.media?.episodes || "-"}`
    const statusLabel = listStatus(entry.listData?.status)
    const hideAudienceScore = serverStatus?.settings?.anilist?.hideAudienceScore ?? false

    const hasTorrentStream = (serverStatus?.torrentstreamSettings?.enabled || serverStatus?.debridSettings?.enabled) && isConnected
    const hasOnlineStream = serverStatus?.settings?.library?.enableOnlinestream && isConnected
    const hasServerLocal = !!serverLocalIdentity && !!serverLocalEntry && !isConnected

    const visibleTabs = React.useMemo(() => {
        return [
            !isOffline && { key: "library", label: "Library" },
            hasServerLocal && { key: "server-local", label: "On Server" },
            hasTorrentStream && { key: "torrentstream", label: "Torrents" },
            hasOnlineStream && { key: "onlinestream", label: "Online" },
            { key: "info", label: "Details" },
        ].filter((tab): tab is { key: AnimeEntryView; label: string } => !!tab)
    }, [hasOnlineStream, hasServerLocal, hasTorrentStream, isOffline])

    useFocusEffect(React.useCallback(() => {
        if (!returnFocus || returnFocus.mediaId !== entry.mediaId) return

        const savedView = tvEntryView(returnFocus.view ?? activeView)
        const canShowSavedView = visibleTabs.some(tab => tab.key === savedView)
        if (canShowSavedView && savedView !== activeView) {
            setActiveView(savedView)
            return
        }

        const timer = setTimeout(() => {
            const episode = episodeRefs.current.get(`${savedView}:${returnFocus.episodeNumber}`)
            const target = episode ?? tabRef.current ?? playRef.current ?? editRef.current
            requestTVFocus(target)
            setReturnFocus(null)
        }, 120)

        return () => clearTimeout(timer)
    }, [
        activeView,
        entry.mediaId,
        returnFocus,
        setActiveView,
        setReturnFocus,
        visibleTabs,
    ]))

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{ paddingBottom: tvSize(80) }}
                showsVerticalScrollIndicator={false}
            >
                <View
                    style={{
                        height: tvSize(500),
                        overflow: "hidden",
                        backgroundColor: "#121212",
                    }}
                >
                    {heroImage ? (
                        <Image
                            source={{ uri: heroImage }}
                            style={{ position: "absolute", inset: 0 }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            priority="high"
                            transition={120}
                        />
                    ) : null}
                    <LinearGradient
                        colors={["rgba(10,10,10,0.96)", "rgba(10,10,10,0.58)", "rgba(10,10,10,0.04)"]}
                        locations={[0, 0.48, 1]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={{ position: "absolute", inset: 0 }}
                    />
                    <LinearGradient
                        colors={["transparent", "rgba(10,10,10,0.26)", "#0a0a0a"]}
                        locations={[0, 0.72, 1]}
                        style={{ position: "absolute", inset: 0 }}
                    />
                    <View
                        style={{
                            position: "absolute",
                            top: tvSize(30),
                            left: TV.gutter,
                        }}
                    >
                        <TVButton
                            label="Back"
                            variant="ghost"
                            size="compact"
                            icon={<Ionicons name="arrow-back" size={tvSize(22)} color="white" />}
                            onPress={() => router.back()}
                        />
                    </View>

                    <View
                        style={{
                            position: "absolute",
                            top: tvSize(96),
                            bottom: tvSize(28),
                            left: TV.gutter,
                            right: TV.gutter,
                            flexDirection: "row",
                            alignItems: "flex-end",
                            gap: tvSize(30),
                        }}
                    >
                        <View
                            style={{
                                width: tvSize(220),
                                height: tvSize(330),
                                flexShrink: 0,
                                overflow: "hidden",
                                borderRadius: tvSize(16),
                                borderWidth: tvSize(2),
                                borderColor: "transparent",
                                backgroundColor: "#181818",
                                shadowColor: "#000000",
                                shadowOpacity: 0.42,
                                shadowRadius: tvSize(18),
                                shadowOffset: { width: 0, height: tvSize(10) },
                                elevation: 16,
                            }}
                        >
                            {coverImage ? (
                                <Image
                                    source={{ uri: coverImage }}
                                    style={{ width: "100%", height: "100%" }}
                                    contentFit="cover"
                                    cachePolicy="memory-disk"
                                    priority="high"
                                    transition={120}
                                />
                            ) : (
                                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                                    <Ionicons
                                        name="image-outline"
                                        size={tvSize(42)}
                                        color="rgba(255,255,255,0.2)"
                                    />
                                </View>
                            )}
                        </View>

                        <View
                            style={{
                                width: "60%",
                                maxWidth: tvSize(980),
                                justifyContent: "flex-end",
                                gap: tvSize(10),
                            }}
                        >
                            <Text
                                className="font-black text-white"
                                style={{ fontSize: tvSize(46), lineHeight: tvSize(52) }}
                                numberOfLines={2}
                            >
                                {heroTitle}
                            </Text>
                            {heroAltTitle ? (
                                <Text
                                    className="font-medium text-white/45"
                                    style={{ fontSize: tvSize(18) }}
                                    numberOfLines={1}
                                >
                                    {heroAltTitle}
                                </Text>
                            ) : null}
                            {heroMeta ? (
                                <Text className="font-medium text-white/60" style={{ fontSize: tvSize(20) }}>
                                    {heroMeta}
                                </Text>
                            ) : null}
                            {heroDescription ? (
                                <Text
                                    className="text-white/60"
                                    style={{ fontSize: tvSize(20), lineHeight: tvSize(28), maxWidth: tvSize(800) }}
                                    numberOfLines={2}
                                >
                                    {heroDescription}
                                </Text>
                            ) : null}

                            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(10) }}>
                                {!hideAudienceScore ? (
                                    <TVScoreBadge score={entry.media?.meanScore} kind="audience" />
                                ) : null}
                                <TVScoreBadge score={entry.listData?.score} kind="user" />
                                {entry.listData ? (
                                    <View
                                        style={{
                                            minHeight: tvSize(42),
                                            justifyContent: "center",
                                            paddingHorizontal: tvSize(16),
                                            borderRadius: tvSize(99),
                                            backgroundColor: "rgba(0,0,0,0.4)",
                                        }}
                                    >
                                        <Text className="font-semibold text-white/80" style={{ fontSize: tvSize(18) }}>
                                            {[statusLabel, progressLabel].filter(Boolean).join("  ·  ")}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        </View>
                    </View>
                </View>

                <OfflineBanner />

                <TVFocusGuideView
                    autoFocus
                    trapFocusLeft
                    trapFocusRight
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(14),
                        paddingTop: tvSize(4),
                        paddingHorizontal: TV.gutter,
                    }}
                >
                    {/*{nextEpisodeToPlay ? (
                        <TVButton
                            ref={playRef}
                            label={unwatchedMainEpisodes[0] ? `Play ${nextEpisodeToPlay.displayTitle}` : `Replay ${nextEpisodeToPlay.displayTitle}`}
                            variant="primary"
                            size="compact"
                            preferred
                            icon={<Ionicons name="play" size={tvSize(22)} color="white" />}
                            onPress={() => playLocalFileEpisode(nextEpisodeToPlay)}
                        />
                    ) : null}*/}
                    <TVPillButton
                        ref={editRef}
                        label={entry.listData ? "Edit entry" : "Add to list"}
                        // preferred={!nextEpisodeToPlay}
                        // preferred
                        icon={(
                            <Ionicons
                                name={entry.listData ? "create-outline" : "add"}
                                size={tvSize(22)}
                                color="#fff"
                            />
                        )}
                        onPress={() => setEditOpen(true)}
                    />
                </TVFocusGuideView>

                <TVTabBar
                    tabs={visibleTabs}
                    activeKey={activeView}
                    activeRef={tabRef}
                    onTabPress={setActiveView}
                />

                <View style={{ flex: 1 }}>
                    {activeView === "library" && (
                        <View style={{ gap: tvSize(30) }}>
                            {mainEpisodes.length > 0 ? (
                                <TVEpisodeGrid
                                    title="Episodes"
                                    episodes={mainEpisodes}
                                    renderItem={renderEpisode}
                                    initialPage={mainEpisodesInitialPage}
                                    after={nextEpisodeToPlay ? (
                                        <TVEpisodePlayButton
                                            episode={nextEpisodeToPlay.episodeNumber}
                                            onPress={() => playLocalFileEpisode(nextEpisodeToPlay)}
                                        />
                                    ) : null}
                                />
                            ) : null}
                            {specialEpisodes.length > 0 ? (
                                <TVEpisodeGrid
                                    title="Specials"
                                    episodes={specialEpisodes}
                                    renderItem={renderEpisode}
                                />
                            ) : null}
                            {ncEpisodes.length > 0 ? (
                                <TVEpisodeGrid
                                    title="NC Episodes"
                                    episodes={ncEpisodes}
                                    renderItem={renderEpisode}
                                />
                            ) : null}
                            {mainEpisodes.length === 0 && specialEpisodes.length === 0 && ncEpisodes.length === 0 ? (
                                <View style={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(20) }}>
                                    <Text className="text-white/60 text-lg">
                                        No local files scanned on your server.
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    )}

                    {activeView === "server-local" && serverLocalEntry ? (
                        <View style={{ gap: tvSize(30) }}>
                            <TVEpisodeGrid
                                title="Episodes"
                                episodes={serverGroups.main}
                                renderItem={renderServerEpisode}
                                initialPage={serverMainInitialPage}
                                after={serverNextEpisode ? (
                                    <TVEpisodePlayButton
                                        episode={serverNextEpisode.episodeNumber}
                                        onPress={() => playServerLocalFileEpisode(serverNextEpisode, serverLocalEntry)}
                                    />
                                ) : null}
                            />
                            <TVEpisodeGrid
                                title="Specials"
                                episodes={serverGroups.special}
                                renderItem={renderServerEpisode}
                            />
                            <TVEpisodeGrid
                                title="NC Episodes"
                                episodes={serverGroups.nc}
                                renderItem={renderServerEpisode}
                            />
                            {serverLocalEntry.episodes?.length ? null : (
                                <View style={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(20) }}>
                                    <Text className="text-white/60" style={{ fontSize: tvSize(20) }}>
                                        No files are available in the cached server catalog.
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : null}

                    {activeView === "torrentstream" && (
                        <AnimeEntryTorrentStreamSection entry={entry} />
                    )}

                    {activeView === "onlinestream" && (
                        <AnimeEntryOnlinestreamSection entry={entry} />
                    )}

                    {activeView === "info" && entry.media && (
                        <TVAnimeEntryInfoView mediaId={entry.media.id} fallbackDescription={entry.media.description} />
                    )}

                </View>
            </ScrollView>
            <TVEditAnilistEntryDrawer
                entry={entry}
                open={editOpen}
                onOpenChange={setEditOpen}
            />
        </View>
    )
}

type TVAnimeEntryInfoViewProps = {
    mediaId: number
    fallbackDescription?: string
}

export const TVAnimeEntryInfoView = React.memo(function TVAnimeEntryInfoView({
    mediaId,
    fallbackDescription,
}: TVAnimeEntryInfoViewProps) {
    const { data, isLoading } = useGetAnilistAnimeDetails(mediaId)

    const description = React.useMemo(() => {
        return cleanHtml(data?.description || fallbackDescription, true)
    }, [data?.description, fallbackDescription])

    const characters = React.useMemo(() => {
        return (data?.characters?.edges ?? []).filter(edge => !!edge.node).slice(0, 15)
    }, [data?.characters?.edges])

    const relations = React.useMemo(() => {
        return (data?.relations?.edges ?? []).filter(
            (edge): edge is AL_AnimeDetailsById_Media_Relations_Edges & { node: AL_BaseAnime } =>
                !!edge.node
                && edge.relationType !== "CHARACTER"
                && edge.node.format !== "MANGA"
                && edge.node.format !== "ONE_SHOT"
                && edge.node.format !== "NOVEL"
                && edge.node.format !== "MUSIC",
        )
    }, [data?.relations?.edges])

    const relationMedia = React.useMemo(() => relations.map(edge => edge.node), [relations])
    const relationBadges = React.useMemo(() => new Map(
        relations.map(edge => {
            const type = edge.relationType ?? ""
            const label = type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ")
            const suffix = edge.node.format === "MOVIE" ? " (Movie)" : ""
            return [edge.node.id, `${label}${suffix}`]
        }),
    ), [relations])

    const recommendations = React.useMemo(() => {
        return (data?.recommendations?.edges ?? [])
            .map(edge => edge.node?.mediaRecommendation)
            .filter((m): m is NonNullable<typeof m> => !!m) as AL_BaseAnime[]
    }, [data?.recommendations?.edges])

    if (isLoading && !data) {
        return <CenteredSpinner />
    }

    return (
        <View style={{ gap: tvSize(40), paddingBottom: tvSize(60) }}>
            {description ? (
                <View style={{ paddingHorizontal: TV.gutter, gap: tvSize(12) }}>
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(30) }}>
                        Description
                    </Text>
                    <Text className="leading-7 text-white/60" style={{ fontSize: tvSize(22) }}>
                        {description}
                    </Text>
                </View>
            ) : null}

            {characters.length > 0 ? (
                <View style={{ gap: tvSize(12) }}>
                    <View style={{ paddingHorizontal: TV.gutter }}>
                        <Text className="font-bold text-white" style={{ fontSize: tvSize(30) }}>
                            Characters
                        </Text>
                    </View>
                    <TVFocusGuideView trapFocusLeft trapFocusRight>
                        <FlatList
                            horizontal
                            data={characters}
                            keyExtractor={item => String(item.id || item.node?.id)}
                            style={{ overflow: "visible" }}
                            contentContainerStyle={{
                                paddingHorizontal: TV.gutter,
                                paddingTop: tvSize(8),
                                paddingBottom: tvSize(8),
                                gap: tvSize(28),
                            }}
                            showsHorizontalScrollIndicator={false}
                            renderItem={({ item }) => <TVCharacterCard edge={item} />}
                        />
                    </TVFocusGuideView>
                </View>
            ) : null}

            {relationMedia.length > 0 ? (
                <TVShelf
                    title="Relations"
                    media={relationMedia}
                    badgeById={relationBadges}
                    showAudienceScore
                />
            ) : null}

            {recommendations.length > 0 ? (
                <TVShelf title="Recommendations" media={recommendations} showAudienceScore />
            ) : null}

            {!description && characters.length === 0 && relationMedia.length === 0 && recommendations.length === 0 ? (
                <View style={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(40), alignItems: "center" }}>
                    <Text className="font-semibold text-white" style={{ fontSize: tvSize(24) }}>
                        No details available
                    </Text>
                    <Text className="text-white/45" style={{ fontSize: tvSize(18), marginTop: tvSize(8) }}>
                        AniList did not return extra information for this title.
                    </Text>
                </View>
            ) : null}
        </View>
    )
})

type TVCharacterCardProps = {
    edge: AL_AnimeDetailsById_Media_Characters_Edges
}

const TVCharacterCard = React.memo(function TVCharacterCard({ edge }: TVCharacterCardProps) {
    const focus = useTVFocus(1.1)
    const name = edge.node?.name?.full || edge.name || "Unknown"
    const image = edge.node?.image?.large

    return (
        <Pressable
            onFocus={focus.focus}
            onBlur={focus.blur}
            style={{ width: tvSize(160), alignItems: "center" }}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        width: tvSize(120),
                        height: tvSize(120),
                        borderRadius: tvSize(60),
                        borderWidth: tvSize(3),
                        borderColor: focus.focused ? "#ffffff" : "transparent",
                        overflow: "hidden",
                        backgroundColor: "rgba(255,255,255,0.05)",
                    },
                ]}
            >
                {image ? (
                    <Image
                        source={{ uri: image }}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                    />
                ) : null}
            </Animated.View>
            <Text
                className="font-semibold text-white text-center"
                numberOfLines={1}
                style={{
                    fontSize: tvSize(18),
                    marginTop: tvSize(10),
                    opacity: focus.focused ? 1 : 0.8,
                    width: "100%",
                }}
            >
                {name}
            </Text>
            {edge.node?.name?.native && edge.node.name.native !== name ? (
                <Text
                    className="text-white/40 text-center"
                    numberOfLines={1}
                    style={{
                        fontSize: tvSize(14),
                        marginTop: tvSize(2),
                        width: "100%",
                    }}
                >
                    {edge.node.name.native}
                </Text>
            ) : null}
            {edge.role ? (
                <Text
                    className="text-white/40 text-center uppercase tracking-wider"
                    numberOfLines={1}
                    style={{
                        fontSize: tvSize(14),
                        marginTop: tvSize(2),
                        width: "100%",
                    }}
                >
                    {edge.role.replace(/_/g, " ")}
                </Text>
            ) : null}
        </Pressable>
    )
})


type TVTabBarProps = {
    tabs: { key: AnimeEntryView; label: string }[]
    activeKey: AnimeEntryView
    activeRef?: React.RefObject<FocusNode | null>
    onTabPress: (key: AnimeEntryView) => void
}

const TVTabBar = React.memo(function TVTabBar({ tabs, activeKey, activeRef, onTabPress }: TVTabBarProps) {
    const layouts = React.useRef<Record<string, { x: number; width: number }>>({})
    const indicatorX = React.useRef(new Animated.Value(0)).current
    const indicatorW = React.useRef(new Animated.Value(0)).current
    const hasInitialized = React.useRef(false)

    React.useEffect(() => {
        const target = layouts.current[activeKey]
        if (!target) return

        if (!hasInitialized.current) {
            indicatorX.setValue(target.x)
            indicatorW.setValue(target.width)
            hasInitialized.current = true
            return
        }

        Animated.parallel([
            Animated.spring(indicatorX, {
                toValue: target.x,
                useNativeDriver: false,
                tension: 200,
                friction: 22,
            }),
            Animated.spring(indicatorW, {
                toValue: target.width,
                useNativeDriver: false,
                tension: 200,
                friction: 22,
            }),
        ]).start()
    }, [activeKey, indicatorX, indicatorW])

    const handleLayout = React.useCallback((key: string, x: number, width: number) => {
        layouts.current[key] = { x, width }
        if (key === activeKey && !hasInitialized.current) {
            indicatorX.setValue(x)
            indicatorW.setValue(width)
            hasInitialized.current = true
        }
    }, [activeKey, indicatorX, indicatorW])

    return (
        <View
            style={{
                marginTop: tvSize(8),
                marginBottom: tvSize(24),
                paddingHorizontal: TV.gutter,
            }}
        >
            <View
                style={{
                    flexDirection: "row",
                    gap: tvSize(6),
                    borderBottomWidth: tvSize(1),
                    borderBottomColor: "rgba(255,255,255,0.06)",
                }}
            >
                {tabs.map((tab, index) => (
                    <TVTabButton
                        ref={activeKey === tab.key ? activeRef : undefined}
                        preferred={index === 0}
                        key={tab.key}
                        tabKey={tab.key}
                        label={tab.label}
                        active={activeKey === tab.key}
                        onPress={() => onTabPress(tab.key)}
                        onTabLayout={handleLayout}
                    />
                ))}
                <Animated.View
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: indicatorX,
                        width: indicatorW,
                        height: tvSize(3),
                        borderTopLeftRadius: tvSize(2),
                        borderTopRightRadius: tvSize(2),
                        backgroundColor: "#a89fff",
                    }}
                />
            </View>
        </View>
    )
})

type TVTabButtonProps = {
    tabKey: string
    label: string
    active: boolean
    onPress: () => void
    onTabLayout: (key: string, x: number, width: number) => void
    preferred?: boolean
}

const TVTabButton = React.memo(React.forwardRef<FocusNode, TVTabButtonProps>(
    function TVTabButton({
        tabKey,
        label,
        active,
        onPress,
        onTabLayout,
        preferred
    }, ref) {
        const focusState = useTVFocus(1.1)

        return (
            <Pressable
                ref={ref}
                onPress={onPress}
                onFocus={focusState.focus}
                onBlur={focusState.blur}
                hasTVPreferredFocus={preferred}
                onLayout={(e) => {
                    const { x, width } = e.nativeEvent.layout
                    onTabLayout(tabKey, x, width)
                }}
                style={{
                    alignItems: "center",
                    paddingVertical: tvSize(16),
                    paddingHorizontal: tvSize(14),
                }}
            >
                <Animated.View
                    style={[
                        focusState.style,
                        {
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(10),
                            borderWidth: tvSize(2),
                            borderColor: focusState.focused ? "#fff" : "transparent",
                            paddingHorizontal: tvSize(12),
                            paddingVertical: tvSize(4),
                            borderRadius: tvSize(12),
                        },
                    ]}
                >
                    <Text
                        style={{
                            fontSize: tvSize(22),
                            fontWeight: active ? "700" : "500",
                            color: focusState.focused
                                ? "#ffffff"
                                : (active ? "#ffffff" : "rgba(255,255,255,0.4)"),
                        }}
                    >
                        {label}
                    </Text>
                </Animated.View>
            </Pressable>
        )
    },
))

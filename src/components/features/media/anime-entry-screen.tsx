import { Anime_Episode } from "@/api/generated/types"
import { animeEntryPlaybackIntentAtom } from "@/atoms/anime-entry.atoms"
import { useServerStatus } from "@/atoms/server.atoms"
import { AnimeEntryDownloadedView } from "@/components/features/media/anime-entry-downloaded-view"
import { AnimeEntryInfoView } from "@/components/features/media/anime-entry-info-view"
import { AnimeEntryLibraryView } from "@/components/features/media/anime-entry-library-view"
import { useAnimeEntryScreen } from "@/components/features/media/anime-entry-screen-context"
import { AnimeEntryServerLocalView } from "@/components/features/media/anime-entry-server-local-view"
import { AnimeEntryView, AnimeEntryViewSwitcher } from "@/components/features/media/anime-entry-view-switcher"
import { MediaEntryHeaderBackground } from "@/components/features/media/media-entry-header"
import { MediaEntryScrollShell } from "@/components/features/media/media-entry-scroll-shell"
import { AnimeEntryOnlinestreamSection } from "@/components/features/onlinestream/anime-entry-onlinestream-section"
import { AnimeEntryTorrentStreamSection } from "@/components/features/torrentstream/anime-entry-torrent-stream-section"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { Styles } from "@/components/shared/styles"
import { useDevScreenProfiler } from "@/hooks/use-dev-screen-profiler"
import { getDefaultPlaybackSource, isPluginPlaybackSource } from "@/lib/default-playback-source"
import { useCompletedEpisodesForMedia } from "@/lib/downloads"
import { useIsServerConnected, useServerConnectionState, useServerLocalAnimeEntry, useServerLocalIdentity } from "@/lib/offline"
import { usePlaybackCoordinator } from "@/lib/player"
import { useIsFocused } from "@react-navigation/native"
import { useAtom } from "jotai"
import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { InteractionManager, RefreshControl, View } from "react-native"
import Animated, { FadeIn, useSharedValue } from "react-native-reanimated"

type AnimeEntryScreenProps = {
    initialView?: AnimeEntryView
}

const autoSwitchedToTorrentstream = new Set<string>()

function getAutomaticAnimeEntryView(
    serverStatus: ReturnType<typeof useServerStatus>,
    hasLibraryData: boolean,
): AnimeEntryView {
    if (hasLibraryData) return "library"
    if (serverStatus?.debridSettings?.enabled && serverStatus.debridSettings.provider) return "torrentstream"
    if (serverStatus?.torrentstreamSettings?.enabled) return "torrentstream"
    if (serverStatus?.settings?.library?.enableOnlinestream) return "onlinestream"
    return "library"
}

function getDefaultAnimeEntryView(
    serverStatus: ReturnType<typeof useServerStatus>,
    hasLibraryData: boolean,
): AnimeEntryView {
    const defaultSource = getDefaultPlaybackSource(serverStatus)

    if (!isPluginPlaybackSource(defaultSource)) {
        if (defaultSource === "library") return "library"
        if (defaultSource === "debridstream" && serverStatus?.debridSettings?.enabled && serverStatus.debridSettings.provider) return "torrentstream"
        if (defaultSource === "torrentstream" && serverStatus?.torrentstreamSettings?.enabled) return "torrentstream"
        if (defaultSource === "onlinestream" && serverStatus?.settings?.library?.enableOnlinestream) return "onlinestream"
    }

    return getAutomaticAnimeEntryView(serverStatus, hasLibraryData)
}

export function AnimeEntryScreen({ initialView = "library" }: AnimeEntryScreenProps) {
    const { id, entry, isFetching, refetch } = useAnimeEntryScreen()
    const [playbackIntent, setPlaybackIntent] = useAtom(animeEntryPlaybackIntentAtom)
    const isFocused = useIsFocused()
    const serverStatus = useServerStatus()
    const connectionState = useServerConnectionState()
    const isConnected = useIsServerConnected()
    const isOffline = connectionState === "disconnected"
    const serverLocalIdentity = useServerLocalIdentity()
    const [currentView, setCurrentView] = useState<AnimeEntryView>(initialView)
    const [isPrimaryBodyReady, setIsPrimaryBodyReady] = useState(false)
    const defaultViewAppliedForIdRef = React.useRef<string | null>(null)
    const libraryScrollY = useSharedValue(0)
    const torrentstreamScrollY = useSharedValue(0)
    const onlinestreamScrollY = useSharedValue(0)
    const infoScrollY = useSharedValue(0)
    const downloadedScrollY = useSharedValue(0)
    const serverLocalScrollY = useSharedValue(0)
    const [mountedViews, setMountedViews] = React.useState<Record<AnimeEntryView, boolean>>({
        library: initialView === "library",
        torrentstream: initialView === "torrentstream",
        onlinestream: initialView === "onlinestream",
        info: initialView === "info",
        downloaded: initialView === "downloaded",
        "server-local": initialView === "server-local",
    })
    const activeScrollY = useMemo(() => {
        switch (currentView) {
            case "torrentstream":
                return torrentstreamScrollY
            case "onlinestream":
                return onlinestreamScrollY
            case "info":
                return infoScrollY
            case "downloaded":
                return downloadedScrollY
            case "server-local":
                return serverLocalScrollY
            case "library":
            default:
                return libraryScrollY
        }
    }, [currentView, downloadedScrollY, infoScrollY, libraryScrollY, onlinestreamScrollY, serverLocalScrollY, torrentstreamScrollY])

    const { mainEpisodes, specialEpisodes, ncEpisodes, unwatchedMainEpisodes, progress } = useMemo(() => {
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
            unwatchedMainEpisodes: main.filter(episode => episode.progressNumber > currentProgress).slice(0, 10), // limit to 10
            progress: currentProgress,
        }
    }, [entry?.episodes, entry?.listData?.progress])

    const hasLibraryEpisodes = mainEpisodes.length > 0 || specialEpisodes.length > 0 || ncEpisodes.length > 0
    const hasTorrentLibraryStream = !!serverStatus?.torrentstreamSettings?.enabled && !!serverStatus?.torrentstreamSettings?.includeInLibrary
    const hasDebridLibraryStream = !!serverStatus?.debridSettings?.enabled
        && !!serverStatus?.debridSettings?.provider
        && !!serverStatus?.debridSettings?.includeDebridStreamInLibrary
    const hasLibraryData = !!entry.libraryData
    const serverLocalEntry = useServerLocalAnimeEntry(entry.mediaId)
    const completedDownloads = useCompletedEpisodesForMedia(entry.mediaId)
    const hasExplicitInitialView = initialView !== "library"
    const defaultPlaybackSource = getDefaultPlaybackSource(serverStatus)
    const shouldUseAutomaticEntrySwitching = !defaultPlaybackSource || isPluginPlaybackSource(defaultPlaybackSource)

    const { playLocalFileEpisode, playServerLocalFileEpisode } = usePlaybackCoordinator(entry)
    const serverLocalEpisodeGroups = useMemo(() => {
        const episodes = serverLocalEntry?.episodes ?? []
        const currentProgress = serverLocalEntry?.listData?.progress ?? 0
        const main = episodes.filter(episode => episode.type === "main")

        return {
            main,
            special: episodes.filter(episode => episode.type === "special"),
            nc: episodes.filter(episode => episode.type === "nc"),
            unwatched: main.filter(episode => episode.progressNumber > currentProgress).slice(0, 10),
        }
    }, [serverLocalEntry])
    const handleServerLocalEpisodePress = React.useCallback((episode: Anime_Episode) => {
        void playServerLocalFileEpisode(episode, serverLocalEntry)
    }, [playServerLocalFileEpisode, serverLocalEntry])

    const handledPlaybackIntentRef = React.useRef<string | null>(null)

    useEffect(() => {
        setMountedViews(prev => prev[currentView] ? prev : { ...prev, [currentView]: true })
    }, [currentView])

    useEffect(() => {
        setIsPrimaryBodyReady(false)

        const task = InteractionManager.runAfterInteractions(() => {
            setIsPrimaryBodyReady(true)
        })

        return () => {
            task.cancel()
        }
    }, [id])

    useDevScreenProfiler(`anime-entry:${id}`, isPrimaryBodyReady)

    useEffect(() => {
        if (isFocused) return

        setMountedViews({
            library: currentView === "library",
            torrentstream: currentView === "torrentstream",
            onlinestream: currentView === "onlinestream",
            info: currentView === "info",
            downloaded: currentView === "downloaded",
            "server-local": currentView === "server-local",
        })
    }, [currentView, isFocused])

    useEffect(() => {
        if (!playbackIntent || playbackIntent.mediaId !== entry.mediaId) return
        if (playbackIntent.kind !== "play-local-episode") return
        if (handledPlaybackIntentRef.current === playbackIntent.id) return
        if (currentView !== "library") {
            setCurrentView("library")
            return
        }

        const targetEpisode = entry.episodes?.find(episode => episode.episodeNumber === playbackIntent.episodeNumber)
        handledPlaybackIntentRef.current = playbackIntent.id
        setPlaybackIntent(current => current?.id === playbackIntent.id ? null : current)

        if (!targetEpisode) return

        playLocalFileEpisode(targetEpisode)
    }, [currentView, entry.episodes, entry.mediaId, playLocalFileEpisode, playbackIntent, setPlaybackIntent])

    useEffect(() => {
        if (hasExplicitInitialView) return
        if (!isConnected) return
        if (!serverStatus?.settings) return
        if (defaultViewAppliedForIdRef.current === id) return

        defaultViewAppliedForIdRef.current = id

        if (entry.media?.status === "NOT_YET_RELEASED") {
            setCurrentView("library")
            return
        }

        const nextView = getDefaultAnimeEntryView(serverStatus, hasLibraryData)
        setCurrentView(current => current === nextView ? current : nextView)
    }, [entry.media?.status, hasExplicitInitialView, hasLibraryData, id, isConnected, serverStatus])

    // When offline, prefer files owned by Tenji, then the cached mobile-server catalog.
    useEffect(() => {
        if (isOffline && (currentView === "library" || currentView === "torrentstream" || currentView === "onlinestream")) {
            setCurrentView(completedDownloads.length > 0 ? "downloaded" : serverLocalEntry ? "server-local" : "downloaded")
        }
    }, [completedDownloads.length, currentView, isOffline, serverLocalEntry])

    useEffect(() => {
        if (currentView !== "server-local" || serverLocalIdentity) return
        setCurrentView(completedDownloads.length > 0 ? "downloaded" : isConnected ? "library" : "downloaded")
    }, [completedDownloads.length, currentView, isConnected, serverLocalIdentity])

    useEffect(() => {
        if (!shouldUseAutomaticEntrySwitching) return
        if (!isConnected) return
        if (currentView !== "library") return
        if (!hasTorrentLibraryStream && !hasDebridLibraryStream) return
        if (hasLibraryEpisodes) return
        if (autoSwitchedToTorrentstream.has(id)) return

        autoSwitchedToTorrentstream.add(id)
        setCurrentView("torrentstream")
    }, [currentView, hasDebridLibraryStream, hasLibraryEpisodes, hasTorrentLibraryStream, id, isConnected, shouldUseAutomaticEntrySwitching])

    useEffect(() => {
        if (!shouldUseAutomaticEntrySwitching) return
        if (!isConnected) return
        if (currentView !== "library") return
        if (hasTorrentLibraryStream || hasDebridLibraryStream) return
        if (!serverStatus?.settings?.library?.includeOnlineStreamingInLibrary) return
        if (!serverStatus?.settings?.library?.enableOnlinestream) return
        if (hasLibraryEpisodes) return
        if (autoSwitchedToTorrentstream.has(id)) return // reuse the same guard set

        autoSwitchedToTorrentstream.add(id)
        setCurrentView("onlinestream")
    }, [currentView, hasDebridLibraryStream, hasLibraryEpisodes, hasTorrentLibraryStream, id, isConnected,
        serverStatus?.settings?.library?.includeOnlineStreamingInLibrary, serverStatus?.settings?.library?.enableOnlinestream,
        shouldUseAutomaticEntrySwitching])

    // hide tabs
    const hiddenViews = useMemo(() => {
        const hidden = new Set<AnimeEntryView>()
        if (!serverStatus?.settings?.library?.enableOnlinestream) {
            hidden.add("onlinestream")
        }
        if (!serverLocalIdentity || isConnected) {
            hidden.add("server-local")
        }
        return hidden
    }, [isConnected, serverLocalIdentity, serverStatus?.settings?.library?.enableOnlinestream])

    const refreshControl = isConnected ? (
        <RefreshControl
            refreshing={isFetching}
            onRefresh={refetch}
            tintColor="rgba(255,255,255,0.45)"
        />
    ) : undefined

    if (!entry?.media) {
        return (
            <View style={[Styles.Container, { justifyContent: "center", alignItems: "center" }]}>
                <CenteredSpinner />
            </View>
        )
    }

    return (
        <Animated.View entering={FadeIn.duration(180)} className="flex-1 bg-background">
            <View className="flex-1">
                <MediaEntryHeaderBackground entry={entry} scrollY={activeScrollY} />

                {mountedViews.library && (
                    <View style={{ flex: currentView === "library" ? 1 : 0, display: currentView === "library" ? "flex" : "none" }}>
                        <AnimeEntryLibraryView
                            entry={entry}
                            mediaId={entry.mediaId}
                            entryProgress={progress}
                            mainEpisodes={mainEpisodes}
                            specialEpisodes={specialEpisodes}
                            ncEpisodes={ncEpisodes}
                            unwatchedMainEpisodes={unwatchedMainEpisodes}
                            onEpisodePress={playLocalFileEpisode}
                            refreshControl={refreshControl}
                            isConnected={isConnected}
                            showDeferredContent={isPrimaryBodyReady}
                            scrollY={libraryScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        />
                    </View>
                )}

                {mountedViews.torrentstream && (
                    <View style={{ flex: currentView === "torrentstream" ? 1 : 0, display: currentView === "torrentstream" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="anime"
                            refreshControl={refreshControl}
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={torrentstreamScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <OfflineBanner />
                            <AnimeEntryTorrentStreamSection entry={entry} />
                        </MediaEntryScrollShell>
                    </View>
                )}

                {mountedViews.onlinestream && (
                    <View style={{ flex: currentView === "onlinestream" ? 1 : 0, display: currentView === "onlinestream" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="anime"
                            refreshControl={refreshControl}
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={onlinestreamScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <OfflineBanner />
                            <AnimeEntryOnlinestreamSection entry={entry} />
                        </MediaEntryScrollShell>
                    </View>
                )}

                {mountedViews.info && (
                    <View style={{ flex: currentView === "info" ? 1 : 0, display: currentView === "info" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="anime"
                            refreshControl={refreshControl}
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={infoScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <OfflineBanner />
                            <AnimeEntryInfoView mediaId={entry.media.id} fallbackDescription={entry.media.description} />
                        </MediaEntryScrollShell>
                    </View>
                )}

                {mountedViews.downloaded && (
                    <View style={{ flex: currentView === "downloaded" ? 1 : 0, display: currentView === "downloaded" ? "flex" : "none" }}>
                        <MediaEntryScrollShell
                            entry={entry}
                            type="anime"
                            refreshControl={refreshControl}
                            contentContainerStyle={{ paddingBottom: 180 }}
                            scrollY={downloadedScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        >
                            <OfflineBanner />
                            <AnimeEntryDownloadedView entry={entry} />
                        </MediaEntryScrollShell>
                    </View>
                )}

                {mountedViews["server-local"] && serverLocalIdentity && (
                    <View
                        style={{
                            flex: currentView === "server-local" ? 1 : 0,
                            display: currentView === "server-local" ? "flex" : "none",
                        }}
                    >
                        <AnimeEntryServerLocalView
                            entry={serverLocalEntry || entry}
                            mediaId={serverLocalEntry ? serverLocalEntry.mediaId : entry.mediaId}
                            entryProgress={serverLocalEntry ? (serverLocalEntry.listData?.progress ?? 0) : progress}
                            mainEpisodes={serverLocalEntry ? serverLocalEpisodeGroups.main : []}
                            specialEpisodes={serverLocalEntry ? serverLocalEpisodeGroups.special : []}
                            ncEpisodes={serverLocalEntry ? serverLocalEpisodeGroups.nc : []}
                            unwatchedMainEpisodes={serverLocalEntry ? serverLocalEpisodeGroups.unwatched : []}
                            onEpisodePress={handleServerLocalEpisodePress}
                            showDeferredContent={isPrimaryBodyReady}
                            scrollY={serverLocalScrollY}
                            showHeaderBackground={false}
                            onTitlePress={() => setCurrentView("info")}
                        />
                    </View>
                )}
            </View>

            <AnimeEntryViewSwitcher
                currentView={currentView}
                onViewChange={setCurrentView}
                isOffline={isOffline}
                hiddenViews={hiddenViews}
            />
        </Animated.View>
    )
}

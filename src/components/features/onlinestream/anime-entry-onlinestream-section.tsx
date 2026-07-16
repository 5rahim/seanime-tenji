import type { Anime_Entry, Anime_Episode, Onlinestream_Episode } from "@/api/generated/types"
import { animeEntryPlaybackIntentAtom } from "@/atoms/anime-entry.atoms"
import { EpisodeListItem } from "@/components/features/anime/episode-list-item"
import { OnlinestreamManualMatchModal } from "@/components/features/onlinestream/onlinestream-manual-match-modal"
import { useOnlinestreamController } from "@/components/features/onlinestream/use-onlinestream-controller"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { EPISODE_PAGE_SIZE, EpisodePageSelector } from "@/components/shared/episode-page-selector"
import { LabeledSwitch } from "@/components/shared/labeled-switch"
import { NativeSelect } from "@/components/shared/native-select"
import { Surface } from "@/components/shared/surface"
import { FormSectionLabel } from "@/components/ui/form-field"
import { usePlaybackCoordinator } from "@/lib/player"
import { cn } from "@/lib/utils"
import { Ionicons } from "@expo/vector-icons"
import { useAtom } from "jotai"
import * as React from "react"
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native"

type AnimeEntryOnlinestreamSectionProps = {
    entry: Anime_Entry
}

export function AnimeEntryOnlinestreamSection({ entry }: AnimeEntryOnlinestreamSectionProps) {
    const controller = useOnlinestreamController({ entry })
    const { playOnlineStreamEpisode } = usePlaybackCoordinator(entry)
    const [playbackIntent, setPlaybackIntent] = useAtom(animeEntryPlaybackIntentAtom)
    const [manualMatchOpen, setManualMatchOpen] = React.useState(false)

    const onlinestreamEpisodeMap = React.useMemo(() => {
        const map = new Map<number, Onlinestream_Episode>()
        for (const ep of controller.episodes) {
            map.set(ep.number, ep)
        }
        return map
    }, [controller.episodes])

    const handleEpisodePress = React.useCallback((episode: Anime_Episode) => {
        const epNumber = episode.episodeNumber
        if (controller.playRequestedEpisode === epNumber) {
            controller.cancelPlayRequest()
            return
        }
        firedPlayRef.current = null
        controller.requestPlay(epNumber)
    }, [controller])

    const firedPlayRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!controller.playRequestedEpisode) return
        if (!controller.selectedVideoSource) return
        if (controller.isLoadingSource) return

        const key = `${controller.provider}-${controller.playRequestedEpisode}-${controller.selectedVideoSource.server}`
        if (firedPlayRef.current === key) return
        firedPlayRef.current = key

        const ep = controller.episodes.find(e => e.number === controller.playRequestedEpisode)

        playOnlineStreamEpisode({
            videoSource: controller.selectedVideoSource,
            episodeNumber: controller.playRequestedEpisode,
            episode: ep?.metadata,
        })

        controller.cancelPlayRequest()
    }, [
        controller.playRequestedEpisode,
        controller.selectedVideoSource,
        controller.isLoadingSource,
        controller.provider,
        controller.episodes,
        playOnlineStreamEpisode,
        controller,
    ])

    React.useEffect(() => {
        firedPlayRef.current = null
    }, [controller.provider, controller.dubbed])

    const handledPlaybackIntentRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!playbackIntent || playbackIntent.mediaId !== entry.mediaId) return
        if (playbackIntent.kind !== "onlinestream-play") return
        if (!controller.provider || controller.isLoadingEpisodes) return
        if (handledPlaybackIntentRef.current === playbackIntent.id) return

        if (controller.episodes.length > 0 && !controller.episodes.some(episode => episode.number === playbackIntent.episodeNumber)) {
            handledPlaybackIntentRef.current = playbackIntent.id
            setPlaybackIntent(current => current?.id === playbackIntent.id ? null : current)
            return
        }

        handledPlaybackIntentRef.current = playbackIntent.id
        firedPlayRef.current = null
        controller.requestPlay(playbackIntent.episodeNumber)
        setPlaybackIntent(current => current?.id === playbackIntent.id ? null : current)
    }, [controller, entry.mediaId, playbackIntent, setPlaybackIntent])

    const { width: windowWidth } = useWindowDimensions()
    const thumbnailWidth = React.useMemo(
        () => Math.min(Math.max(windowWidth * 0.4, 128), 160),
        [windowWidth],
    )

    const [onlinePage, setOnlinePage] = React.useState(() =>
        Math.floor(controller.progress / EPISODE_PAGE_SIZE),
    )

    React.useEffect(() => {
        setOnlinePage(Math.floor(controller.progress / EPISODE_PAGE_SIZE))
    }, [controller.provider, controller.dubbed, controller.progress])

    const pagedOnlineEpisodes = React.useMemo(() => {
        const start = onlinePage * EPISODE_PAGE_SIZE
        return controller.episodes.slice(start, start + EPISODE_PAGE_SIZE)
    }, [controller.episodes, onlinePage])

    return (
        <>

            <View className="px-4 mb-5">
                <Surface variant="muted" className="p-3.5 gap-4">

                    <View className="gap-2">
                        <FormSectionLabel>Provider</FormSectionLabel>
                        {controller.isLoadingProviders ? (
                            <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                        ) : controller.providerExtensions.length === 0 ? (
                            <Text className="text-sm text-white/35">No online streaming extensions installed</Text>
                        ) : (
                            <NativeSelect
                                options={controller.providerExtensions.map(p => ({ id: p.id, label: p.name }))}
                                selectedId={controller.provider}
                                onSelect={controller.setProvider}
                                title="Select Provider"
                                placeholder="Select provider"
                            />
                        )}
                    </View>


                    {controller.availableServers.length > 1 && (
                        <View className="gap-2">
                            <FormSectionLabel>Server</FormSectionLabel>
                            <View className="flex-row flex-wrap gap-2">
                                {controller.availableServers.map(server => {
                                    const selected = controller.selectedServer === server
                                    return (
                                        <Pressable
                                            key={server}
                                            onPress={() => controller.setSelectedServer(server)}
                                            className={cn(
                                                "h-9 flex-row items-center gap-1.5 rounded-full border px-3.5",
                                                selected
                                                    ? "border-brand-300 bg-brand-300/15"
                                                    : "border-white/10 bg-white/[0.04] active:bg-white/10",
                                            )}
                                        >
                                            <Text
                                                className={cn(
                                                    "text-sm font-medium",
                                                    selected ? "text-brand-300" : "text-foreground/70",
                                                )}
                                            >
                                                {server}
                                            </Text>
                                        </Pressable>
                                    )
                                })}
                            </View>
                        </View>
                    )}


                    <View className="items-center gap-4">
                        {controller.currentProvider?.supportsDub ? (
                            <LabeledSwitch
                                label="Dubbed"
                                checked={controller.dubbed}
                                onToggle={() => controller.setDubbed(!controller.dubbed)}
                            />
                        ) : (
                            <View />
                        )}


                        {controller.availableQualities.length > 1 && (
                            <View className="gap-2 w-full">
                                <FormSectionLabel>Quality</FormSectionLabel>
                                <View className="flex-row flex-wrap gap-2">
                                    {controller.availableQualities.map(quality => {
                                        const normalizedSelected = controller.selectedQuality?.includes("p")
                                            ? controller.selectedQuality.split("p")[0].toLowerCase() + "p"
                                            : controller.selectedQuality
                                        const normalizedQuality = quality?.includes("p")
                                            ? quality.split("p")[0].toLowerCase() + "p"
                                            : quality
                                        const selected = normalizedSelected
                                            ? normalizedQuality?.toLowerCase().includes(normalizedSelected)
                                            : controller.selectedVideoSource?.quality === quality
                                        return (
                                            <Pressable
                                                key={quality}
                                                onPress={() => controller.setSelectedQuality(quality)}
                                                className={cn(
                                                    "h-9 flex-row items-center gap-1.5 rounded-full border px-3.5",
                                                    selected
                                                        ? "border-brand-300 bg-brand-300/15"
                                                        : "border-white/10 bg-white/[0.04] active:bg-white/10",
                                                )}
                                            >
                                                <Text
                                                    className={cn(
                                                        "text-sm font-medium",
                                                        selected ? "text-brand-300" : "text-foreground/70",
                                                    )}
                                                >
                                                    {quality}
                                                </Text>
                                            </Pressable>
                                        )
                                    })}
                                </View>
                            </View>
                        )}

                        <View className="flex-row gap-2">

                            <Pressable
                                onPress={() => setManualMatchOpen(true)}
                                className="h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] border border-white/10 active:bg-white/10"
                            >
                                <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.6)" />
                            </Pressable>


                            <Pressable
                                onPress={controller.handleEmptyCache}
                                disabled={controller.isEmptyingCache}
                                className="h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] border border-white/10 active:bg-white/10"
                            >
                                {controller.isEmptyingCache ? (
                                    <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                                ) : (
                                    <Ionicons name="refresh-outline" size={16} color="rgba(255,255,255,0.6)" />
                                )}
                            </Pressable>
                        </View>
                    </View>
                </Surface>
            </View>


            {controller.isLoadingEpisodes && (
                <View className="py-10">
                    <CenteredSpinner />
                </View>
            )}


            {!controller.isLoadingEpisodes && controller.episodes.length === 0 && !!controller.provider && (
                <View className="py-16 items-center gap-3">
                    <Ionicons name="videocam-off-outline" size={40} color="rgba(255,255,255,0.2)" />
                    <Text className="text-white/40 text-sm text-center px-8">
                        No episodes found for this provider.{"\n"}Try a different provider or use manual matching.
                    </Text>
                </View>
            )}


            {!controller.isLoadingEpisodes && controller.episodes.length > 0 && (
                <View className="px-4">
                    <Text className="text-xl font-bold text-foreground mb-3">Episodes</Text>
                    {controller.episodes.length > EPISODE_PAGE_SIZE && (
                        <View className="mb-3 -mx-4">
                            <EpisodePageSelector
                                totalCount={controller.episodes.length}
                                currentPage={onlinePage}
                                onPageChange={setOnlinePage}
                                logName="online episodes"
                            />
                        </View>
                    )}
                    <View>
                        {pagedOnlineEpisodes.map((onlineEp, index) => {
                            const isWatched = onlineEp.number <= controller.progress
                            const isLoading = onlineEp.number === controller.playRequestedEpisode && controller.isLoadingSource

                            const animeEpisode: Anime_Episode = onlineEp.metadata ?? {
                                type: "main",
                                displayTitle: `Episode ${onlineEp.number}`,
                                episodeTitle: onlineEp.title ?? "",
                                episodeNumber: onlineEp.number,
                                absoluteEpisodeNumber: onlineEp.number,
                                progressNumber: onlineEp.number,
                                isDownloaded: false,
                                isInvalid: false,
                                _isNakamaEpisode: false,
                            }

                            return (
                                <EpisodeListItem
                                    key={`${onlineEp.number}-${index}`}
                                    episode={animeEpisode}
                                    fallbackImage={entry.media?.bannerImage}
                                    isWatched={isWatched}
                                    thumbnailWidth={thumbnailWidth}
                                    onEpisodePress={handleEpisodePress}
                                    isFirst={index === 0}
                                    isLast={index === pagedOnlineEpisodes.length - 1}
                                    // showPlayOverlay={onlineEp.number !== controller.playRequestedEpisode}
                                    isLoadingOverlay={isLoading}
                                    isFiller={onlineEp.isFiller}
                                    imageOverride={onlineEp.image}
                                    watchedProgress={controller.progress}
                                />
                            )
                        })}
                    </View>
                </View>
            )}


            <OnlinestreamManualMatchModal
                open={manualMatchOpen}
                onOpenChange={setManualMatchOpen}
                mediaId={controller.mediaId ?? 0}
                provider={controller.provider}
                dubbed={controller.dubbed}
                mediaTitle={
                    entry.media?.title?.userPreferred
                    ?? entry.media?.title?.english
                    ?? entry.media?.title?.romaji
                    ?? ""
                }
            />
        </>
    )
}


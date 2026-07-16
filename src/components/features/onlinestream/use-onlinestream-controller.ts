import type { Anime_Entry, ExtensionRepo_OnlinestreamProviderExtensionItem, Onlinestream_VideoSource } from "@/api/generated/types"
import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useGetOnlineStreamEpisodeList, useGetOnlineStreamEpisodeSource, useOnlineStreamEmptyCache } from "@/api/hooks/onlinestream.hooks"
import { createAtomStorage } from "@/atoms/storage"
import { logger } from "@/lib/utils/logger"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import * as React from "react"

const log = logger("online-stream")

function normalizeLabel(value: string | null | undefined): string | null {
    return value?.trim().toLowerCase() ?? null
}

function getQualityResolution(value: string | null | undefined): string | null {
    const normalized = normalizeLabel(value)

    return normalized?.match(/\b(\d{3,4}p|auto|default)\b/i)?.[1]?.toLowerCase() ?? null
}

function dedupeVideoSources(sources: Onlinestream_VideoSource[]): Onlinestream_VideoSource[] {
    const seen = new Set<string>()
    const deduped: Onlinestream_VideoSource[] = []

    for (const source of sources) {
        const key = `${source.url}|${source.quality}|${source.server}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(source)
    }

    return deduped
}

////////////////////////// Persisted atoms

const selectedProviderAtom = atomWithStorage<string | null>(
    "sea-onlinestream-provider",
    null,
    createAtomStorage<string | null>(),
)

const selectedServerAtom = atomWithStorage<string | null>(
    "sea-onlinestream-server",
    null,
    createAtomStorage<string | null>(),
)

export const selectedQualityAtom = atomWithStorage<string | null>(
    "sea-onlinestream-quality",
    null,
    createAtomStorage<string | null>(),
)

export type OnlinestreamControllerState = {
    provider: string
    dubbed: boolean
    selectedServer: string | null
}

type UseOnlinestreamControllerParams = {
    entry: Anime_Entry
}

export function useOnlinestreamController({ entry }: UseOnlinestreamControllerParams) {
    const mediaId = entry.media?.id
    const progress = entry.listData?.progress ?? 0

    // provider extensions
    const { data: providerExtensions, isLoading: isLoadingProviders } = useListOnlinestreamProviderExtensions()

    // persisted selection state
    const [provider, setProvider] = useAtom(selectedProviderAtom)
    const [dubbed, setDubbed] = React.useState(false)
    const [selectedServer, setSelectedServer] = useAtom(selectedServerAtom)

    const [playRequestedEpisode, setPlayRequestedEpisode] = React.useState<number | null>(null)

    const sortedProviderExtensions = React.useMemo(() => {
        return [...(providerExtensions ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    }, [providerExtensions])

    // auto-select provider: use stored preference if valid, otherwise first available
    React.useEffect(() => {
        if (!providerExtensions || providerExtensions.length === 0) return
        if (provider && providerExtensions.some(p => p.id === provider)) return
        setProvider(providerExtensions[0].id)
    }, [provider, providerExtensions, setProvider])

    // episode list, always fetched so the episodes are visible
    const {
        data: episodeListResponse,
        isLoading: isLoadingEpisodes,
        isFetching: isFetchingEpisodes,
        error: episodeListError,
    } = useGetOnlineStreamEpisodeList(mediaId, provider ?? "", dubbed)

    const episodes = React.useMemo(
        () => episodeListResponse?.episodes ?? [],
        [episodeListResponse?.episodes],
    )

    // episode source, ONLY fetched when user explicitly requests playback
    const {
        data: episodeSource,
        isLoading: isLoadingSource,
        isFetching: isFetchingSource,
        error: episodeSourceError,
    } = useGetOnlineStreamEpisodeSource(
        mediaId,
        provider ?? "",
        playRequestedEpisode ?? 0,
        dubbed,
        playRequestedEpisode !== null && !!provider, // only enabled when a play was requested
    )

    const allVideoSources = React.useMemo(
        () => episodeSource?.videoSources ?? [],
        [episodeSource?.videoSources],
    )

    React.useEffect(() => {
        if (!episodeListResponse || !mediaId || !provider) return
        log.info("Online episodes loaded", {
            mediaId,
            provider,
            dubbed,
            count: episodeListResponse.episodes?.length ?? 0,
        })
    }, [dubbed, episodeListResponse, mediaId, provider])

    React.useEffect(() => {
        if (!episodeListError) return
        log.warning("Failed to load online episodes", { mediaId, provider, dubbed }, episodeListError)
    }, [dubbed, episodeListError, mediaId, provider])

    React.useEffect(() => {
        if (!episodeSource || playRequestedEpisode === null) return
        log.info("Online stream sources loaded", {
            mediaId,
            provider,
            episodeNumber: playRequestedEpisode,
            sourceCount: episodeSource.videoSources?.length ?? 0,
        })
    }, [episodeSource, mediaId, playRequestedEpisode, provider])

    React.useEffect(() => {
        if (!episodeSourceError || playRequestedEpisode === null) return
        log.warning("Failed to load online stream sources", {
            mediaId,
            provider,
            episodeNumber: playRequestedEpisode,
        }, episodeSourceError)
    }, [episodeSourceError, mediaId, playRequestedEpisode, provider])

    // persisted quality preference
    const [selectedQuality, setSelectedQuality] = useAtom(selectedQualityAtom)

    // available servers derived from sources
    const availableServers = React.useMemo(() => {
        const servers = new Set<string>()
        for (const s of allVideoSources) {
            if (s.server) servers.add(s.server)
        }
        return Array.from(servers)
    }, [allVideoSources])

    // auto-select server when sources arrive
    React.useEffect(() => {
        if (availableServers.length === 0) {
            setSelectedServer(null)
            return
        }
        if (selectedServer && availableServers.includes(selectedServer)) return
        setSelectedServer(availableServers[0])
    }, [availableServers, selectedServer, setSelectedServer])

    // available qualities derived from server-filtered sources
    const serverFilteredSources = React.useMemo(() => {
        if (!selectedServer) return dedupeVideoSources(allVideoSources)
        return dedupeVideoSources(allVideoSources.filter(v => v.server === selectedServer))
    }, [allVideoSources, selectedServer])

    const availableQualities = React.useMemo(() => {
        const quals = new Set<string>()
        for (const s of serverFilteredSources) {
            if (s.quality) quals.add(s.quality)
        }
        return Array.from(quals)
    }, [serverFilteredSources])

    // selected video source, filtered by server then quality
    const selectedVideoSource = React.useMemo<Onlinestream_VideoSource | null>(() => {
        let filtered = [...serverFilteredSources]
        if (filtered.length === 0) return null

        const normalizedQuality = normalizeLabel(selectedQuality)
        const preferredResolution = getQualityResolution(selectedQuality)
        const hasExactQuality = normalizedQuality && filtered.some(s => normalizeLabel(s.quality) === normalizedQuality)
        const hasPreferredResolution = preferredResolution && filtered.some(s => getQualityResolution(s.quality) === preferredResolution)
        const hasAuto = filtered.some(s => s.quality === "auto")

        if (normalizedQuality && hasExactQuality) {
            filtered = filtered.filter(s => normalizeLabel(s.quality) === normalizedQuality)
        } else if (preferredResolution && hasPreferredResolution) {
            filtered = filtered.filter(s => getQualityResolution(s.quality) === preferredResolution)
        } else if (hasAuto) {
            filtered = filtered.filter(s => s.quality.toLowerCase() === "auto" || s.quality.toLowerCase().includes("default"))
        } else {
            if (filtered.some(s => s.quality.includes("1080p"))) {
                filtered = filtered.filter(s => s.quality.includes("1080p"))
            } else if (filtered.some(s => s.quality.includes("720p"))) {
                filtered = filtered.filter(s => s.quality.includes("720p"))
            } else if (filtered.some(s => s.quality.includes("480p"))) {
                filtered = filtered.filter(s => s.quality.includes("480p"))
            } else if (filtered.some(s => s.quality.includes("360p"))) {
                filtered = filtered.filter(s => s.quality.includes("360p"))
            }

            if (filtered.some(s => s.quality.includes("default"))) {
                filtered = filtered.filter(s => s.quality.includes("default"))
            }
        }

        return filtered[0] ?? serverFilteredSources[0] ?? null
    }, [serverFilteredSources, selectedQuality])

    // current provider extension
    const currentProvider = React.useMemo<ExtensionRepo_OnlinestreamProviderExtensionItem | null>(
        () => providerExtensions?.find(p => p.id === provider) ?? null,
        [providerExtensions, provider],
    )

    // cache clearing
    const { mutate: emptyCache, isPending: isEmptyingCache } = useOnlineStreamEmptyCache()
    const handleEmptyCache = React.useCallback(() => {
        if (!mediaId) return
        emptyCache({ mediaId })
    }, [mediaId, emptyCache])

    // reset state when provider or dubbed changes
    const handleProviderChange = React.useCallback((newProvider: string) => {
        log.info("Online stream provider changed", { mediaId, provider: newProvider })
        setProvider(newProvider)
        setPlayRequestedEpisode(null)
        setSelectedServer(null)
    }, [mediaId, setProvider, setSelectedServer])

    const handleDubbedChange = React.useCallback((newDubbed: boolean) => {
        log.info("Online stream audio mode changed", { mediaId, dubbed: newDubbed })
        setDubbed(newDubbed)
        setPlayRequestedEpisode(null)
        setSelectedServer(null)
    }, [mediaId, setSelectedServer])

    // user taps an episode, start fetching sources for it
    const requestPlay = React.useCallback((episodeNumber: number) => {
        log.info("Online stream playback requested", { mediaId, provider, episodeNumber, dubbed })
        setPlayRequestedEpisode(episodeNumber)
    }, [dubbed, mediaId, provider])

    // cancel the current play request (e.g. user taps same episode again)
    const cancelPlayRequest = React.useCallback(() => {
        setPlayRequestedEpisode(null)
    }, [])

    return {
        mediaId,
        progress,
        provider: provider ?? "",
        setProvider: handleProviderChange,
        dubbed,
        setDubbed: handleDubbedChange,
        selectedServer,
        setSelectedServer,
        selectedQuality,
        setSelectedQuality,
        availableQualities,
        episodes,
        episodeListResponse,
        videoSources: serverFilteredSources,
        availableServers,
        selectedVideoSource,
        currentProvider,
        providerExtensions: sortedProviderExtensions,
        isLoadingProviders,
        isLoadingEpisodes: isLoadingEpisodes || isFetchingEpisodes,
        isLoadingSource: isLoadingSource || isFetchingSource,
        handleEmptyCache,
        isEmptyingCache,
        // play flow
        playRequestedEpisode,
        requestPlay,
        cancelPlayRequest,
    }
}

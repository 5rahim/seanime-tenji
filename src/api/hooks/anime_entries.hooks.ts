import { useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    AnimeEntryBulkAction_Variables,
    AnimeEntryManualMatch_Variables,
    FetchAnimeEntrySuggestions_Variables,
    OpenAnimeEntryInExplorer_Variables,
    ToggleAnimeEntrySilenceStatus_Variables,
    UpdateAnimeEntryProgress_Variables,
    UpdateAnimeEntryRepeat_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_BaseAnime, Anime_Entry, Anime_LocalFile, Anime_MissingEpisodes, Anime_UpcomingEpisodes, Nullish } from "@/api/generated/types"
import {
    createListDataConflictGuard,
    getServerLocalAnimeRecord,
    parseServerLocalAnimeEntry,
    updateAnimeDownloadEntrySnapshotProgress,
    updateServerLocalAnimeProgress,
    useServerLocalIdentity,
} from "@/lib/offline"
import { useOfflineProgressUpdate } from "@/lib/offline"
import { toast } from "@/lib/utils/toast"
import type { MutationFunctionContext } from "@tanstack/query-core"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

export function useGetAnimeEntry(id: Nullish<string | number>) {
    return useServerQuery<Anime_Entry>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)],
        enabled: !!id,
    })
}

export function useAnimeEntryBulkAction(id?: Nullish<number>, onSuccess?: () => void) {
    const queryClient = useQueryClient()

    return useServerMutation<Array<Anime_LocalFile>, AnimeEntryBulkAction_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryBulkAction.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryBulkAction.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryBulkAction.key, String(id)],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)] })
            queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.LIBRARY_EXPLORER.GetLibraryExplorerFileTree.key] })
            onSuccess?.()
        },
    })
}

export function useOpenAnimeEntryInExplorer() {
    return useServerMutation<boolean, OpenAnimeEntryInExplorer_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.OpenAnimeEntryInExplorer.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.OpenAnimeEntryInExplorer.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.OpenAnimeEntryInExplorer.key],
        onSuccess: async () => {

        },
    })
}

export function useFetchAnimeEntrySuggestions() {
    return useServerMutation<Array<AL_BaseAnime>, FetchAnimeEntrySuggestions_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.FetchAnimeEntrySuggestions.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.FetchAnimeEntrySuggestions.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.FetchAnimeEntrySuggestions.key],
        onSuccess: async () => {

        },
    })
}

export function useAnimeEntryManualMatch() {
    const queryClient = useQueryClient()

    return useServerMutation<Array<Anime_LocalFile>, AnimeEntryManualMatch_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryManualMatch.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryManualMatch.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.AnimeEntryManualMatch.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.LIBRARY_EXPLORER.GetLibraryExplorerFileTree.key] })
            toast.success("Files matched")
        },
    })
}

export function useGetMissingEpisodes(enabled?: boolean) {
    return useServerQuery<Anime_MissingEpisodes>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key],
        enabled: enabled ?? true, // Default to true if not provided
    })
}

export function useGetAnimeEntrySilenceStatus(id: Nullish<string | number>) {
    const { data, ...rest } = useServerQuery({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntrySilenceStatus.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntrySilenceStatus.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntrySilenceStatus.key],
        enabled: !!id,
    })

    return { isSilenced: !!data, ...rest }
}

export function useToggleAnimeEntrySilenceStatus() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, ToggleAnimeEntrySilenceStatus_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.ToggleAnimeEntrySilenceStatus.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.ToggleAnimeEntrySilenceStatus.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.ToggleAnimeEntrySilenceStatus.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntrySilenceStatus.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
        },
    })
}

export function useUpdateAnimeEntryProgress(id: Nullish<string | number>, episodeNumber: number, showToast: boolean = true) {
    const queryClient = useQueryClient()
    const queueProgressUpdate = useOfflineProgressUpdate()
    const serverLocalIdentity = useServerLocalIdentity()

    const mutation = useServerMutation<boolean, UpdateAnimeEntryProgress_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryProgress.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryProgress.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryProgress.key, id, episodeNumber],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            if (id) {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)] })
            }
            if (showToast) {
                toast.success("Progress updated successfully")
            }
        },
    })

    const applyOptimisticProgress = useCallback((variables: UpdateAnimeEntryProgress_Variables) => {
        const targetMediaId = id ?? variables.mediaId
        if (!targetMediaId) return

        updateAnimeDownloadEntrySnapshotProgress(Number(targetMediaId), variables.episodeNumber)
        updateServerLocalAnimeProgress(Number(targetMediaId), variables.episodeNumber, serverLocalIdentity)

        queryClient.setQueryData<Anime_Entry | undefined>(
            [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(targetMediaId)],
            current => {
                if (!current) return current

                const nextProgress = Math.max(current.listData?.progress ?? 0, variables.episodeNumber)

                return {
                    ...current,
                    listData: {
                        ...(current.listData ?? {}),
                        progress: nextProgress,
                    },
                }
            },
        )
    }, [id, queryClient])

    const createConflictGuard = useCallback((variables: UpdateAnimeEntryProgress_Variables) => {
        const targetMediaId = Number(id ?? variables.mediaId)
        if (!Number.isFinite(targetMediaId)) return undefined

        const queryEntry = queryClient.getQueryData<Anime_Entry | undefined>([
            API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key,
            String(targetMediaId),
        ])
        const currentEntry = queryEntry
            ?? parseServerLocalAnimeEntry(getServerLocalAnimeRecord(targetMediaId, serverLocalIdentity))

        return createListDataConflictGuard("anime", targetMediaId, currentEntry)
    }, [id, queryClient, serverLocalIdentity])

    const handleQueuedSuccess = useCallback((variables: UpdateAnimeEntryProgress_Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
        const queuedContext = {} as MutationFunctionContext

        applyOptimisticProgress(variables)
        options?.onSuccess?.(true, variables, undefined, queuedContext)
        options?.onSettled?.(true, null, variables, undefined, queuedContext)
    }, [applyOptimisticProgress])

    const mutate: typeof mutation.mutate = useCallback((variables, options) => {
        if (queueProgressUpdate(variables, createConflictGuard(variables))) {
            handleQueuedSuccess(variables, options)
            return
        }

        mutation.mutate(variables, options)
    }, [createConflictGuard, handleQueuedSuccess, mutation, queueProgressUpdate])

    const mutateAsync: typeof mutation.mutateAsync = useCallback(async (variables, options) => {
        if (queueProgressUpdate(variables, createConflictGuard(variables))) {
            handleQueuedSuccess(variables, options)
            return true
        }

        return mutation.mutateAsync(variables, options)
    }, [createConflictGuard, handleQueuedSuccess, mutation, queueProgressUpdate])

    return {
        ...mutation,
        mutate,
        mutateAsync,
    }
}

export function useUpdateAnimeEntryRepeat(id: Nullish<string | number>) {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, UpdateAnimeEntryRepeat_Variables>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryRepeat.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryRepeat.methods[0],
        mutationKey: [API_ENDPOINTS.ANIME_ENTRIES.UpdateAnimeEntryRepeat.key, id],
        onSuccess: async () => {
            // if (id) {
            //     await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)] })
            // }
            // toast.success("Updated successfully")
        },
    })
}

export function useGetUpcomingEpisodes(enabled: boolean = true) {
    return useServerQuery<Anime_UpcomingEpisodes>({
        endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetUpcomingEpisodes.endpoint,
        method: API_ENDPOINTS.ANIME_ENTRIES.GetUpcomingEpisodes.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetUpcomingEpisodes.key],
        enabled,
    })
}

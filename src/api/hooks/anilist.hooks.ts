import { useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    AnilistListAnime_Variables,
    AnilistListRecentAiringAnime_Variables,
    DeleteAnilistListEntry_Variables,
    EditAnilistListEntry_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import {
    AL_AnimeCollection,
    AL_AnimeDetailsById_Media,
    AL_BaseAnime,
    AL_FuzzyDateInput,
    AL_ListAnime,
    AL_ListRecentAnime,
    AL_Stats,
    AL_StudioDetails,
    Anime_Entry,
    Manga_Entry,
    Nullish,
} from "@/api/generated/types"
import { createListDataConflictGuard, useOfflineListEntryDelete, useOfflineListEntryEdit } from "@/lib/offline"
import { toast } from "@/lib/utils/toast"
import type { MutationFunctionContext } from "@tanstack/query-core"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

function getEntryQueryKey(type: "anime" | "manga", mediaId: string | number) {
    return type === "anime"
        ? [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(mediaId)]
        : [API_ENDPOINTS.MANGA.GetMangaEntry.key, String(mediaId)]
}

function fuzzyDateToEntryDateString(value?: AL_FuzzyDateInput): string | undefined {
    if (!value?.year || !value.month || !value.day) return undefined

    return new Date(Date.UTC(value.year, value.month - 1, value.day)).toISOString()
}

function applyOptimisticListEntryUpdate(
    queryClient: ReturnType<typeof useQueryClient>,
    type: "anime" | "manga",
    mediaId: string | number,
    listDataPatch: Partial<NonNullable<Anime_Entry["listData"]>>,
) {
    queryClient.setQueryData<Anime_Entry | Manga_Entry | undefined>(
        getEntryQueryKey(type, mediaId),
        current => {
            if (!current) return current

            return {
                ...current,
                listData: {
                    ...(current.listData ?? {}),
                    ...listDataPatch,
                },
            }
        },
    )
}

function applyOptimisticListEntryDelete(
    queryClient: ReturnType<typeof useQueryClient>,
    type: "anime" | "manga",
    mediaId: string | number,
) {
    queryClient.setQueryData<Anime_Entry | Manga_Entry | undefined>(
        getEntryQueryKey(type, mediaId),
        current => {
            if (!current) return current

            return {
                ...current,
                listData: undefined,
            }
        },
    )
}

function createListEntryConflictGuard(
    queryClient: ReturnType<typeof useQueryClient>,
    type: "anime" | "manga",
    mediaId: string | number | undefined,
) {
    const numericMediaId = Number(mediaId)
    if (!Number.isFinite(numericMediaId)) return undefined

    const currentEntry = queryClient.getQueryData<Anime_Entry | Manga_Entry | undefined>(getEntryQueryKey(type, numericMediaId))

    return createListDataConflictGuard(type, numericMediaId, currentEntry)
}

export function useGetAnimeCollection() {
    return useServerQuery<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnimeCollection.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key],
        enabled: true,
    })
}

export function useGetRawAnimeCollection() {
    return useServerQuery<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetRawAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetRawAnimeCollection.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key],
        enabled: true,
    })
}

export function useRefreshAnimeCollection() {
    const queryClient = useQueryClient()

    return useServerMutation<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnimeCollection.methods[1],
        mutationKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key],
        onSuccess: async () => {
            toast.success("AniList is up-to-date")
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key] })
        },
    })
}

export function useEditAnilistListEntry(id: Nullish<string | number>, type: "anime" | "manga") {
    const queryClient = useQueryClient()
    const queueListEntryEdit = useOfflineListEntryEdit()

    const mutation = useServerMutation<boolean, EditAnilistListEntry_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.EditAnilistListEntry.endpoint,
        method: API_ENDPOINTS.ANILIST.EditAnilistListEntry.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.EditAnilistListEntry.key, String(id)],
        onSuccess: async () => {
            toast.success("Entry updated")
            if (type === "anime") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
            } else if (type === "manga") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetAnilistMangaCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            }
        },
    })

    const handleQueuedSuccess = useCallback((variables: EditAnilistListEntry_Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
        const queuedContext = {} as MutationFunctionContext

        const targetMediaId = variables.mediaId ?? id
        if (!targetMediaId) return

        applyOptimisticListEntryUpdate(queryClient, type, targetMediaId, {
            status: variables.status,
            score: variables.score,
            progress: variables.progress,
            startedAt: fuzzyDateToEntryDateString(variables.startedAt),
            completedAt: fuzzyDateToEntryDateString(variables.completedAt),
        })

        options?.onSuccess?.(true, variables, undefined, queuedContext)
        options?.onSettled?.(true, null, variables, undefined, queuedContext)
    }, [id, queryClient, type])

    const mutate: typeof mutation.mutate = useCallback((variables, options) => {
        if (queueListEntryEdit(variables, createListEntryConflictGuard(queryClient, type, variables.mediaId ?? id ?? undefined))) {
            handleQueuedSuccess(variables, options)
            return
        }

        mutation.mutate(variables, options)
    }, [handleQueuedSuccess, id, mutation, queryClient, queueListEntryEdit, type])

    const mutateAsync: typeof mutation.mutateAsync = useCallback(async (variables, options) => {
        if (queueListEntryEdit(variables, createListEntryConflictGuard(queryClient, type, variables.mediaId ?? id ?? undefined))) {
            handleQueuedSuccess(variables, options)
            return true
        }

        return mutation.mutateAsync(variables, options)
    }, [handleQueuedSuccess, id, mutation, queryClient, queueListEntryEdit, type])

    return {
        ...mutation,
        mutate,
        mutateAsync,
    }
}

export function useGetAnilistAnimeDetails(id: Nullish<number | string>) {
    return useServerQuery<AL_AnimeDetailsById_Media>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.key, String(id)],
        enabled: !!id,
    })
}

export function useDeleteAnilistListEntry(id: Nullish<string | number>,
    type: "anime" | "manga",
    onSuccess: () => void,
    queueOffline: boolean = true,
) {
    const queryClient = useQueryClient()
    const queueListEntryDelete = useOfflineListEntryDelete()

    const mutation = useServerMutation<boolean, DeleteAnilistListEntry_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.endpoint,
        method: API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.key],
        onSuccess: async () => {
            toast.success("Entry deleted")
            if (type === "anime") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
            } else if (type === "manga") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetAnilistMangaCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            }
            onSuccess()
        },
    })

    const handleQueuedSuccess = useCallback((variables: DeleteAnilistListEntry_Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
        const queuedContext = {} as MutationFunctionContext

        const targetMediaId = variables.mediaId ?? id
        if (!targetMediaId) return

        applyOptimisticListEntryDelete(queryClient, type, targetMediaId)
        onSuccess()
        options?.onSuccess?.(true, variables, undefined, queuedContext)
        options?.onSettled?.(true, null, variables, undefined, queuedContext)
    }, [id, onSuccess, queryClient, type])

    const mutate: typeof mutation.mutate = useCallback((variables, options) => {
        if (queueOffline && queueListEntryDelete(variables, createListEntryConflictGuard(queryClient, type, variables.mediaId ?? id ?? undefined))) {
            handleQueuedSuccess(variables, options)
            return
        }

        mutation.mutate(variables, options)
    }, [handleQueuedSuccess, id, mutation, queryClient, queueListEntryDelete, queueOffline, type])

    const mutateAsync: typeof mutation.mutateAsync = useCallback(async (variables, options) => {
        if (queueOffline && queueListEntryDelete(variables, createListEntryConflictGuard(queryClient, type, variables.mediaId ?? id ?? undefined))) {
            handleQueuedSuccess(variables, options)
            return true
        }

        return mutation.mutateAsync(variables, options)
    }, [handleQueuedSuccess, id, mutation, queryClient, queueListEntryDelete, queueOffline, type])

    return {
        ...mutation,
        mutate,
        mutateAsync,
    }
}

export function useAnilistListAnime(variables: AnilistListAnime_Variables, enabled: boolean) {
    return useServerQuery<AL_ListAnime, AnilistListAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListAnime.key, variables],
        data: variables,
        enabled: enabled ?? true,
    })
}

export function useAnilistListRecentAiringAnime(variables: AnilistListRecentAiringAnime_Variables, enabled: boolean = true) {
    return useServerQuery<AL_ListRecentAnime, AnilistListRecentAiringAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.key, JSON.stringify(variables)],
        data: variables,
        enabled: enabled,
    })
}

export function useGetAnilistStudioDetails(id: number) {
    return useServerQuery<AL_StudioDetails>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnilistStudioDetails.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.ANILIST.GetAnilistStudioDetails.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnilistStudioDetails.key, String(id)],
        enabled: true,
    })
}

export function useGetAniListStats(enabled: boolean = true) {
    return useServerQuery<AL_Stats>({
        endpoint: API_ENDPOINTS.ANILIST.GetAniListStats.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAniListStats.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAniListStats.key],
        enabled: enabled,
    })
}

export function useAnilistListMissedSequels(enabled: boolean) {
    return useServerQuery<Array<AL_BaseAnime>>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key],
        enabled: enabled,
    })
}

export function useGetAnilistCacheLayerStatus() {
    return useServerQuery<boolean>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.key],
        gcTime: 0,
        enabled: true,
    })
}

export function useToggleAnilistCacheLayerStatus() {
    const queryClient = useQueryClient()
    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.endpoint,
        method: API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.key] })
        },
    })
}

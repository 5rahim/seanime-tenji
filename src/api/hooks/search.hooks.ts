import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_ListAnime, AL_ListManga } from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { getAnimeSearchVariables, getMangaSearchVariables, SearchParams } from "@/lib/search/search-atoms"
import { logger } from "@/lib/utils/logger"
import { useInfiniteQuery } from "@tanstack/react-query"

const log = logger("search-pagination")

function logPage(kind: "anime" | "manga", page: number, count: number, hasNext: boolean | undefined) {
    log.info(`Loaded ${kind} search page ${page}`, { count, hasNext: !!hasNext })
}

export function useInfiniteAnimeSearch(params: SearchParams, enabled: boolean) {
    const serverUrl = useServerUrl()

    return useInfiniteQuery({
        queryKey: ["infinite-anime-search", params, serverUrl],
        initialPageParam: 1,
        queryFn: async ({ pageParam }) => {
            const page = Number(pageParam)
            log.info(`Loading anime search page ${page}`)
            const result = await buildSeaQuery<AL_ListAnime>({
                serverUrl,
                endpoint: API_ENDPOINTS.ANILIST.AnilistListAnime.endpoint,
                method: API_ENDPOINTS.ANILIST.AnilistListAnime.methods[0],
                data: getAnimeSearchVariables(params, page),
            })
            logPage("anime", page, result?.Page?.media?.length ?? 0, result?.Page?.pageInfo?.hasNextPage)
            return result
        },
        getNextPageParam: (lastPage) => {
            const curr = lastPage?.Page?.pageInfo?.currentPage
            const hasNext = lastPage?.Page?.pageInfo?.hasNextPage
            return curr != null && hasNext ? curr + 1 : undefined
        },
        enabled: !!serverUrl && enabled && params.type === "anime",
    })
}

export function useInfiniteMangaSearch(params: SearchParams, enabled: boolean) {
    const serverUrl = useServerUrl()

    return useInfiniteQuery({
        queryKey: ["infinite-manga-search", params, serverUrl],
        initialPageParam: 1,
        queryFn: async ({ pageParam }) => {
            const page = Number(pageParam)
            log.info(`Loading manga search page ${page}`)
            const result = await buildSeaQuery<AL_ListManga>({
                serverUrl,
                endpoint: API_ENDPOINTS.MANGA.AnilistListManga.endpoint,
                method: API_ENDPOINTS.MANGA.AnilistListManga.methods[0],
                data: getMangaSearchVariables(params, page),
            })
            logPage("manga", page, result?.Page?.media?.length ?? 0, result?.Page?.pageInfo?.hasNextPage)
            return result
        },
        getNextPageParam: (lastPage) => {
            const curr = lastPage?.Page?.pageInfo?.currentPage
            const hasNext = lastPage?.Page?.pageInfo?.hasNextPage
            return curr != null && hasNext ? curr + 1 : undefined
        },
        enabled: !!serverUrl && enabled && params.type === "manga",
    })
}

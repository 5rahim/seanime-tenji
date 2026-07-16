import { getServerAuthHeaders } from "@/api/client/server-auth"
import { getServerBaseUrl } from "@/api/client/server-url"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseAnime, Anime_EntryListData, Anime_Episode, Status } from "@/api/generated/types"
import { normalizeServerLocalUrl, type ServerLocalIdentity } from "@/lib/offline/server-local-store"
import { logger } from "@/lib/utils/logger"
import { getLocalEpisodePlaybackSource } from "./local-file-source"
import type { MobilePlaybackSource } from "./types"

const CHECK_TIMEOUT_MS = 1000
const RESOLUTION_CACHE_TTL_MS = 30_000

const log = logger("server-local-source")
const resolutionCache = new Map<string, { serverUrl: string, expiresAt: number }>()

type ResolveServerLocalEpisodePlaybackSourceParams = {
    mediaId: number
    episode: Anime_Episode
    identity: ServerLocalIdentity
    configuredServerUrl: string
    media?: AL_BaseAnime
    entryListData?: Anime_EntryListData
    episodes?: Anime_Episode[]
}

function getLoopbackServerUrl(configuredServerUrl: string): string {
    try {
        const url = new URL(getServerBaseUrl(configuredServerUrl))
        const port = url.port || "43211"
        return `http://127.0.0.1:${port}`
    }
    catch {
        return "http://127.0.0.1:43211"
    }
}

function isMatchingStatus(status: Status | undefined, identity: ServerLocalIdentity): boolean {
    if (identity.os === "ios") {
        return status?.os?.toLowerCase() === "ios"
    }
    return status?.os?.toLowerCase() === identity.os && status.dataDir === identity.dataDir
}

async function probeServerUrl(serverUrl: string, identity: ServerLocalIdentity): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

    try {
        const response = await fetch(
            `${normalizeServerLocalUrl(serverUrl)}${API_ENDPOINTS.STATUS.GetStatus.endpoint}`,
            {
                method: API_ENDPOINTS.STATUS.GetStatus.methods[0],
                headers: {
                    Accept: "application/json",
                    ...getServerAuthHeaders(),
                },
                signal: controller.signal,
            },
        )
        if (!response.ok) return false

        const body = await response.json() as { data?: Status }
        return isMatchingStatus(body.data, identity)
    }
    catch {
        return false
    }
    finally {
        clearTimeout(timeout)
    }
}

export async function resolveServerLocalServerUrl(
    configuredServerUrl: string,
    identity: ServerLocalIdentity,
): Promise<string | null> {
    const cached = resolutionCache.get(identity.key)
    if (cached && cached.expiresAt > Date.now()) {
        log.info("Using cached server-local playback address", { serverOS: identity.os })
        return cached.serverUrl
    }

    const candidates = Array.from(new Set([
        normalizeServerLocalUrl(getLoopbackServerUrl(configuredServerUrl)),
        normalizeServerLocalUrl(configuredServerUrl),
    ]))

    log.info("Probing server-local playback addresses", {
        serverOS: identity.os,
        candidateCount: candidates.length,
    })

    for (const [index, candidate] of candidates.entries()) {
        if (await probeServerUrl(candidate, identity)) {
            resolutionCache.set(identity.key, {
                serverUrl: candidate,
                expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS,
            })
            log.success("Resolved server-local playback address", {
                serverOS: identity.os,
                addressKind: index === 0 ? "loopback" : "configured",
            })
            return candidate
        }
    }

    resolutionCache.delete(identity.key)
    log.warning("No matching mobile server responded to server-local playback", {
        serverOS: identity.os,
        candidateCount: candidates.length,
    })
    return null
}

export async function resolveServerLocalEpisodePlaybackSource(
    params: ResolveServerLocalEpisodePlaybackSourceParams,
): Promise<MobilePlaybackSource | null> {
    const downloadedSource = getLocalEpisodePlaybackSource({
        ...params,
        serverUrl: null,
        entryView: "server-local",
        serverLocalIdentity: params.identity,
    })
    if (downloadedSource) return downloadedSource

    const resolvedServerUrl = await resolveServerLocalServerUrl(params.configuredServerUrl, params.identity)
    if (!resolvedServerUrl) return null

    return getLocalEpisodePlaybackSource({
        ...params,
        serverUrl: resolvedServerUrl,
        entryView: "server-local",
        serverLocalIdentity: params.identity,
    })
}

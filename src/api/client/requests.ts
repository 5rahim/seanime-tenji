import { getClientHeaders, saveClientIdentityFromHeaders } from "@/api/client/client-identity"
import { createRequestControl, DEFAULT_REQUEST_TIMEOUT_MS } from "@/api/client/request-control"
import { getServerAuthHeaders } from "@/api/client/server-auth"
import { getServerBaseUrl } from "@/api/client/server-url"
import { getStoredServerAuthToken, useServerAuthToken, useServerUrl, useSetServerAuthToken } from "@/atoms/server.atoms"
import { isGlobalConnected, isManualOfflineModeEnabled, markServerReachable, markServerUnreachable } from "@/lib/connection-state"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { useMutation, UseMutationOptions, useQuery, UseQueryOptions } from "@tanstack/react-query"
import { useEffect } from "react"


export type SeaError = Error & {
    error: string
    status?: number
}

const log = logger("requests")

type SeaQuery<D> = {
    serverUrl: string | null | undefined
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
    data?: D
    params?: D
    authToken?: string | null
    muteError?: boolean
    bypassOfflineCheck?: boolean
    timeoutMs?: number
    signal?: AbortSignal | readonly (AbortSignal | undefined)[]
}

function createSeaError(message: string, status?: number): SeaError {
    const error = new Error(message) as SeaError
    error.error = message
    error.status = status
    return error
}

function normalizeSeaError(error: unknown): SeaError {
    if (error instanceof Error && "error" in error && typeof error.error === "string") {
        return error as SeaError
    }

    if (error instanceof Error) {
        return createSeaError(error.message)
    }

    if (typeof error === "string") {
        return createSeaError(error)
    }

    if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") {
        return createSeaError(error.error)
    }

    return createSeaError("Unknown error occurred")
}

function isConnectivityFailure(error: unknown, seaError: SeaError): boolean {
    if (seaError.status !== undefined) return false

    if (error instanceof Error && error.name === "AbortError") {
        return false
    }

    const message = seaError.error.toLowerCase()

    return error instanceof TypeError
        || message.includes("network request failed")
        || message.includes("failed to fetch")
        || message.includes("load failed")
        || message.includes("network error")
        || message.includes("internet connection appears to be offline")
}

export async function buildSeaQuery<T, D = unknown>(
    {
        serverUrl,
        endpoint,
        method,
        data,
        params,
        authToken,
        muteError,
        bypassOfflineCheck,
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
        signal,
    }: SeaQuery<D>): Promise<T | undefined> {
    const url = new URL(getServerBaseUrl(serverUrl) + endpoint)
    const resolvedAuthToken = authToken ?? getStoredServerAuthToken()
    const startedAt = Date.now()

    // append params to the url if they exist and it's a GET request
    if (params && method === "GET") {
        Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value))
            }
        })
    }

    // Configure fetch options
    const options: RequestInit = {
        method,
        headers: {
            "Content-Type": "application/json",
            ...getServerAuthHeaders(resolvedAuthToken),
            ...getClientHeaders(),
        },
    }

    if (data && method !== "GET") {
        options.body = JSON.stringify(data)
    }

    if (isManualOfflineModeEnabled() && !bypassOfflineCheck) {
        return Promise.reject(createSeaError("OFFLINE_MODE_ENABLED"))
    }

    const request = createRequestControl(signal, timeoutMs)
    options.signal = request.signal

    try {
        const response = await fetch(url.toString(), options)
        markServerReachable()
        saveClientIdentityFromHeaders(response.headers)

        const text = await response.text()
        let responseData: { data?: T; error?: string } | undefined

        if (text) {
            try {
                responseData = JSON.parse(text) as { data?: T; error?: string }
            }
            catch {
                if (!response.ok) {
                    throw createSeaError(`Request failed with status ${response.status}`, response.status)
                }

                return text as T
            }
        }

        if (!text) {
            if (!response.ok) {
                throw createSeaError(`Request failed with status ${response.status}`, response.status)
            }
            return undefined as T
        }

        if (!response.ok) {
            // Handle error by returning a rejected promise with the error message
            throw createSeaError(responseData?.error || "Unknown error occurred", response.status)
        }

        return responseData?.data as T
    }
    catch (error: unknown) {
        const timedOut = request.didTimeout()
        const wasAborted = request.signal.aborted && !timedOut
        if (wasAborted) throw error

        const seaError = timedOut
            ? createSeaError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`)
            : normalizeSeaError(error)
        const connectivityFailure = isConnectivityFailure(error, seaError)

        if (connectivityFailure) {
            markServerUnreachable()
        }

        log.warning(`${method} ${endpoint} failed`, {
            status: seaError.status ?? null,
            connectivityFailure,
            durationMs: Date.now() - startedAt,
        }, seaError)
        // only show toast when we believe the device is online, avoids
        // spamming "Network request failed" toasts while offline
        if (!muteError && isGlobalConnected()) {
            toast.error(_handleSeaError(seaError.error), {
                visibilityTime: 5000,
            })
        }
        // Return the error message as rejected promise to be handled by tsquery
        return Promise.reject(seaError)
    }
    finally {
        request.clear()
    }
}

type ServerMutationProps<R, V = void> = UseMutationOptions<R | undefined, SeaError, V, unknown> & {
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
    timeoutMs?: number
    signal?: AbortSignal
    muteError?: boolean
}

export function useServerMutation<R = void, V = void>(
    {
        endpoint,
        method,
        onError: userOnError,
        timeoutMs,
        signal,
        muteError,
        ...options
    }: ServerMutationProps<R, V>) {

    const serverUrl = useServerUrl()
    const authToken = useServerAuthToken()
    const setServerAuthToken = useSetServerAuthToken()

    return useMutation<R | undefined, SeaError, V>({
        onError: (error, variables, onMutateResult, mutationContext) => {
            if (error.error === "UNAUTHENTICATED") {
                setServerAuthToken(null)
                userOnError?.(error, variables, onMutateResult, mutationContext)
                return
            }

            userOnError?.(error, variables, onMutateResult, mutationContext)
        },
        mutationFn: async (variables) => {
            return buildSeaQuery<R, V>({
                serverUrl: serverUrl,
                endpoint: endpoint,
                method: method,
                data: variables,
                authToken,
                timeoutMs,
                signal,
                muteError,
            })
        },
        ...options,
    })
}


type ServerQueryProps<R, V> = UseQueryOptions<R | undefined, SeaError, R | undefined> & {
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
    params?: V
    data?: V
    muteError?: boolean
    timeoutMs?: number
    signal?: AbortSignal
}

export function useServerQuery<R, V = any>(
    {
        endpoint,
        method,
        params,
        data,
        muteError,
        timeoutMs,
        signal,
        ...options
    }: ServerQueryProps<R | undefined, V>) {
    const serverUrl = useServerUrl()
    const authToken = useServerAuthToken()
    const setServerAuthToken = useSetServerAuthToken()

    const props = useQuery<R | undefined, SeaError>({
        queryFn: async ({ signal: querySignal }) => {
            return buildSeaQuery<R, V>({
                serverUrl: serverUrl,
                endpoint: endpoint,
                method: method,
                params: params,
                data: data,
                authToken,
                muteError,
                timeoutMs,
                signal: [signal, querySignal],
            })
        },
        ...options,
        enabled: !!serverUrl && (options.enabled ?? true),
    })

    useEffect(() => {
        if (!props.isError) return

        if (props.error?.error === "UNAUTHENTICATED") {
            setServerAuthToken(null)
            return
        }

    }, [props.error, props.isError, setServerAuthToken])

    return props
}

//----------------------------------------------------------------------------------------------------------------------

function _handleSeaError(data: any): string {
    if (typeof data === "string") return "Server Error: " + data

    const err = data?.error as string

    if (!err) return "Unknown error"

    if (err.includes("Too many requests"))
        return "AniList: Too many requests, please wait a moment and try again."

    try {
        const graphqlErr = JSON.parse(err) as any
        log.warning("AniList error", graphqlErr)
        if (graphqlErr.graphqlErrors && graphqlErr.graphqlErrors.length > 0 && !!graphqlErr.graphqlErrors[0]?.message) {
            return "AniList error: " + graphqlErr.graphqlErrors[0]?.message
        }
        return "AniList error"
    }
    catch (e) {
        return "Error: " + err
    }
}

function _handleSeaResponse<T>(res: unknown): { data: T | undefined, error: string | undefined } {

    if (typeof res === "object" && !!res && "error" in res && typeof res.error === "string") {
        return { data: undefined, error: res.error }
    }
    if (typeof res === "object" && !!res && "data" in res) {
        return { data: res.data as T, error: undefined }
    }

    return { data: undefined, error: "No response from the server" }

}

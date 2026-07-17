import { getStoredString, removeStoredKey, setStoredString } from "@/atoms/storage"

const CLIENT_ID_STORAGE_KEY = "sea-server-client-id"
const CLIENT_ID_PROOF_STORAGE_KEY = "sea-server-client-id-proof"

const CLIENT_ID_HEADER_NAME = "X-Seanime-Client-Id"
const CLIENT_ID_PROOF_HEADER_NAME = "X-Seanime-Client-Id-Proof"
const CLIENT_PLATFORM_HEADER_NAME = "X-Seanime-Client-Platform"

const CLIENT_ID_QUERY_PARAM = "id"
const CLIENT_ID_PROOF_QUERY_PARAM = "proof"
const CLIENT_PLATFORM_QUERY_PARAM = "platform"

export const SERVER_CLIENT_PLATFORM = "mobile"

export type ClientIdentity = {
    clientId: string
    clientIdProof: string
}

function normalizeValue(value: string | null | undefined): string {
    return (value ?? "").trim()
}

function readStoredClientIdentity(): ClientIdentity {
    return {
        clientId: normalizeValue(getStoredString(CLIENT_ID_STORAGE_KEY)),
        clientIdProof: normalizeValue(getStoredString(CLIENT_ID_PROOF_STORAGE_KEY)),
    }
}

function createClientId(): string {
    const cryptoApi = globalThis.crypto as {
        randomUUID?: () => string
        getRandomValues?: (array: Uint8Array) => Uint8Array
    } | undefined

    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID()
    }

    if (typeof cryptoApi?.getRandomValues === "function") {
        return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, character => {
            const randomByte = cryptoApi.getRandomValues?.(new Uint8Array(1))[0] ?? 0
            return (Number(character) ^ (randomByte & (15 >> (Number(character) / 4)))).toString(16)
        })
    }

    return `seanime-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`
}

function getHeaderValue(headers: unknown, name: string): string {
    if (typeof headers === "object" && headers !== null && "get" in headers && typeof headers.get === "function") {
        const value = headers.get(name)
        if (typeof value === "string" && value.trim()) {
            return value.trim()
        }

        return ""
    }

    const headersRecord = headers as Record<string, string | string[] | undefined>
    const rawValue = headersRecord?.[name] ?? headersRecord?.[name.toLowerCase()]

    if (typeof rawValue === "string" && rawValue.trim()) {
        return rawValue.trim()
    }

    if (Array.isArray(rawValue) && typeof rawValue[0] === "string" && rawValue[0].trim()) {
        return rawValue[0].trim()
    }

    return ""
}

function saveClientIdentity(clientId: string, clientIdProof: string = ""): ClientIdentity {
    const normalizedClientId = normalizeValue(clientId)
    const normalizedProof = normalizeValue(clientIdProof)

    if (!normalizedClientId) {
        return readStoredClientIdentity()
    }

    setStoredString(CLIENT_ID_STORAGE_KEY, normalizedClientId)

    if (normalizedProof) {
        setStoredString(CLIENT_ID_PROOF_STORAGE_KEY, normalizedProof)
    } else {
        removeStoredKey(CLIENT_ID_PROOF_STORAGE_KEY)
    }

    return {
        clientId: normalizedClientId,
        clientIdProof: normalizedProof,
    }
}

export function getClientIdentity(): ClientIdentity {
    const existing = readStoredClientIdentity()
    if (existing.clientId) {
        return existing
    }

    return saveClientIdentity(createClientId())
}

export function getClientHeaders(): Record<string, string> {
    const { clientId, clientIdProof } = getClientIdentity()
    const headers: Record<string, string> = {
        [CLIENT_PLATFORM_HEADER_NAME]: SERVER_CLIENT_PLATFORM,
    }

    if (clientId && clientIdProof) {
        headers[CLIENT_ID_HEADER_NAME] = clientId
        headers[CLIENT_ID_PROOF_HEADER_NAME] = clientIdProof
    }

    return headers
}

export function addClientQueryParams(searchParams: URLSearchParams) {
    const { clientId, clientIdProof } = getClientIdentity()

    if (clientId && clientIdProof) {
        searchParams.set(CLIENT_ID_QUERY_PARAM, clientId)
        searchParams.set(CLIENT_ID_PROOF_QUERY_PARAM, clientIdProof)
    }

    searchParams.set(CLIENT_PLATFORM_QUERY_PARAM, SERVER_CLIENT_PLATFORM)
}

export function saveClientIdentityFromHeaders(headers: unknown) {
    const clientId = getHeaderValue(headers, CLIENT_ID_HEADER_NAME)
    const clientIdProof = getHeaderValue(headers, CLIENT_ID_PROOF_HEADER_NAME)

    if (clientId) {
        saveClientIdentity(clientId, clientIdProof)
    }
}

export function saveClientIdentityFromEvent(payload: unknown): ClientIdentity | null {
    if (typeof payload !== "object" || payload === null) {
        return null
    }

    const clientId = normalizeValue("clientId" in payload && typeof payload.clientId === "string" ? payload.clientId : "")
    const clientIdProof = normalizeValue("proof" in payload && typeof payload.proof === "string" ? payload.proof : "")

    if (clientId) {
        return saveClientIdentity(clientId, clientIdProof)
    }

    return null
}

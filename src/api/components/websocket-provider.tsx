import { addClientQueryParams, getClientIdentity, saveClientIdentityFromEvent } from "@/api/client/client-identity"
import { getServerBaseUrl } from "@/api/client/server-url"
import { useWebsocketEventRouter } from "@/api/components/websocket-event-router"
import { publishWsMessage, type WebsocketMessage } from "@/api/components/websocket-hub"
import { useServerAuthToken, useServerUrl, useServerUrlProtocol } from "@/atoms/server.atoms"
import { degradeServerReachability, markServerReachable } from "@/lib/connection-state"
import { manualOfflineModeAtom } from "@/lib/offline/manual-offline-mode"
import { logger } from "@/lib/utils/logger"
import { atom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import React from "react"
import { AppState } from "react-native"

const CLIENT_IDENTITY_EVENT = "client-identity"
const log = logger("websocket-provider")

export const websocketConnectedAtom = atom(false)
export const websocketConnectionStateAtom = atom<"idle" | "connecting" | "connected" | "disconnected">("idle")

function parseMessage(data: unknown): WebsocketMessage | null {
    if (typeof data !== "string") return null

    try {
        const message = JSON.parse(data) as { type?: unknown; payload?: unknown }
        if (typeof message.type !== "string") return null
        return { type: message.type, payload: message.payload }
    }
    catch (error) {
        log.warning("Failed to parse WebSocket message", error)
        return null
    }
}

export function WebsocketProvider({ children }: { children: React.ReactNode }) {
    const serverUrl = useServerUrl()
    const serverAuthToken = useServerAuthToken()
    const serverUrlProtocol = useServerUrlProtocol()
    const manualOffline = useAtomValue(manualOfflineModeAtom)
    const [, setIsConnected] = useAtom(websocketConnectedAtom)
    const [, setConnectionState] = useAtom(websocketConnectionStateAtom)

    useWebsocketEventRouter()

    React.useEffect(() => {
        if (!serverUrl || manualOffline) {
            setIsConnected(false)
            setConnectionState(manualOffline ? "disconnected" : "idle")
            return
        }

        let socket: WebSocket | null = null
        let cancelled = false
        let retryCount = 0
        let retryTimer: ReturnType<typeof setTimeout> | null = null

        const clearRetry = () => {
            if (!retryTimer) return
            clearTimeout(retryTimer)
            retryTimer = null
        }

        const connect = () => {
            if (cancelled || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return

            clearRetry()
            setConnectionState("connecting")

            const params = new URLSearchParams()
            addClientQueryParams(params)
            if (serverAuthToken) params.set("token", serverAuthToken)

            const scheme = serverUrlProtocol === "https:" ? "wss" : "ws"
            const url = `${scheme}://${getServerBaseUrl(serverUrl, true)}/events?${params.toString()}`
            const nextSocket = new WebSocket(url)
            socket = nextSocket
            log.info("Connecting to WebSocket", url)

            nextSocket.addEventListener("open", () => {
                if (cancelled || socket !== nextSocket) return
                log.info("WebSocket connection opened")
                retryCount = 0
                setIsConnected(true)
                setConnectionState("connected")
                markServerReachable()
            })

            nextSocket.addEventListener("message", event => {
                const message = parseMessage(event.data)
                if (!message) return

                let identityChanged = false
                if (message.type === CLIENT_IDENTITY_EVENT) {
                    const previous = getClientIdentity()
                    const saved = saveClientIdentityFromEvent(message.payload)
                    identityChanged = !!saved && saved.clientId !== previous.clientId
                }

                publishWsMessage(message)

                if (identityChanged && socket === nextSocket) {
                    log.info("Server assigned a new client ID; reconnecting WebSocket")
                    nextSocket.close()
                }
            })

            nextSocket.addEventListener("close", () => {
                if (cancelled || socket !== nextSocket) return

                socket = null
                setIsConnected(false)
                setConnectionState("disconnected")
                degradeServerReachability()

                retryCount += 1
                const delay = retryCount === 1 ? 0 : Math.min(1500 * Math.pow(2, retryCount - 2), 30_000)
                log.info(`Reconnecting in ${delay}ms (attempt ${retryCount})`)
                retryTimer = setTimeout(connect, delay)
            })
        }

        const appStateSub = AppState.addEventListener("change", state => {
            if (state !== "active") return
            if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                retryCount = 0
                connect()
            }
        })

        connect()

        return () => {
            cancelled = true
            clearRetry()
            appStateSub.remove()
            socket?.close()
        }
    }, [manualOffline, serverAuthToken, serverUrl, serverUrlProtocol, setConnectionState, setIsConnected])

    return children
}

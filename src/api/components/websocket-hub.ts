export type WebsocketMessage = Readonly<{
    type: string
    payload?: unknown
}>

export type WebsocketMessageListener = (message: WebsocketMessage) => void | Promise<void>

const listeners = new Set<WebsocketMessageListener>()

export function subscribeWsMessage(listener: WebsocketMessageListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function publishWsMessage(message: WebsocketMessage) {
    for (const listener of listeners) {
        try {
            Promise.resolve(listener(message)).catch(error => {
                console.warn("WebSocket listener failed", error)
            })
        }
        catch (error) {
            console.warn("WebSocket listener failed", error)
        }
    }
}

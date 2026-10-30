export type IdleTask = { cancel: () => void }

export function runAfterInteractions(callback: () => void, timeout = 500): IdleTask {
    if (typeof requestIdleCallback === "function") {
        const handle = requestIdleCallback(() => callback(), { timeout })
        return { cancel: () => cancelIdleCallback(handle) }
    }
    const handle = setTimeout(callback, 0)
    return { cancel: () => clearTimeout(handle) }
}

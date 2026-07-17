export const DEFAULT_REQUEST_TIMEOUT_MS = 45_000
export const LONG_REQUEST_TIMEOUT_MS = 120_000

type SignalInput = AbortSignal | readonly (AbortSignal | undefined)[] | undefined

export type RequestControl = {
    signal: AbortSignal
    clear: () => void
    didTimeout: () => boolean
}

export function createRequestControl(
    input?: SignalInput,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): RequestControl {
    const controller = new AbortController()
    const signals = !input ? [] : "aborted" in input ? [input] : input.filter((signal): signal is AbortSignal => !!signal)
    let timedOut = false

    const abort = (signal: AbortSignal) => controller.abort(signal.reason)
    const cleanups: Array<() => void> = []

    for (const signal of signals) {
        if (signal.aborted) {
            abort(signal)
            break
        }
        const onAbort = () => abort(signal)
        signal.addEventListener("abort", onAbort, { once: true })
        cleanups.push(() => signal.removeEventListener("abort", onAbort))
    }

    const timer = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
        }, timeoutMs)
        : null

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        clear: () => {
            if (timer) clearTimeout(timer)
            for (const cleanup of cleanups) cleanup()
        },
    }
}

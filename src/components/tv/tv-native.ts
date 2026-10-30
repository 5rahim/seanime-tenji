import type { TVRemoteEvent } from "react-native"

type TVFocusable = { requestTVFocus?: () => void }

export function requestTVFocus(target: object | null | undefined) {
    (target as TVFocusable | null | undefined)?.requestTVFocus?.()
}

export function tvKeyAction(event: TVRemoteEvent): 0 | 1 | undefined {
    const action = Number(event.eventKeyAction)
    return action === 0 || action === 1 ? action : undefined
}

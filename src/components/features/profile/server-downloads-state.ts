export type DownloadQueueViewState = "loading" | "error" | "empty" | "content"

type DownloadQueueViewStateInput = {
    hasData: boolean
    isError: boolean
    isRefetchError: boolean
    isSuccess: boolean
    itemCount: number
}

export function getDownloadQueueViewState({
    hasData,
    isError,
    isRefetchError,
    isSuccess,
    itemCount,
}: DownloadQueueViewStateInput): DownloadQueueViewState {
    if (!hasData) {
        return isError || isSuccess ? "error" : "loading"
    }

    if (isRefetchError && itemCount === 0) {
        return "error"
    }

    return itemCount === 0 ? "empty" : "content"
}

export function shouldShowQueueRefreshWarning(viewState: DownloadQueueViewState, isRefetchError: boolean): boolean {
    return viewState === "content" && isRefetchError
}

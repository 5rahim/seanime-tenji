import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { DeleteLogs_Variables, GetAnnouncements_Variables, UpdateHomeItems_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { MemoryStatsResponse, Models_HomeItem, Status, Updater_Announcement } from "@/api/generated/types"
import { toast } from "@/lib/utils/toast"
import { useQueryClient } from "@tanstack/react-query"

export function useGetStatus(options?: { enabled?: boolean }) {
    return useServerQuery<Status>({
        endpoint: API_ENDPOINTS.STATUS.GetStatus.endpoint,
        method: API_ENDPOINTS.STATUS.GetStatus.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetStatus.key],
        enabled: options?.enabled ?? true,
        retryDelay: 1000,
        // Fixes macOS desktop app startup issue
        retry: 3,
        refetchOnMount: "always",
        refetchOnReconnect: true,
        refetchInterval: 60000,
        // suppress error toasts, connection state is shown via the offline banner
        muteError: true,
    })
}

export function useGetLogFilenames() {
    return useServerQuery<Array<string>>({
        endpoint: API_ENDPOINTS.STATUS.GetLogFilenames.endpoint,
        method: API_ENDPOINTS.STATUS.GetLogFilenames.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetLogFilenames.key],
        enabled: true,
    })
}

export function useDeleteLogs() {
    const qc = useQueryClient()
    return useServerMutation<boolean, DeleteLogs_Variables>({
        endpoint: API_ENDPOINTS.STATUS.DeleteLogs.endpoint,
        method: API_ENDPOINTS.STATUS.DeleteLogs.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.DeleteLogs.key],
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetLogFilenames.key] })
            toast.success("Logs deleted")
        },
    })
}

export function useGetLatestLogContent() {
    const qc = useQueryClient()
    return useServerMutation<string>({
        endpoint: API_ENDPOINTS.STATUS.GetLatestLogContent.endpoint,
        method: API_ENDPOINTS.STATUS.GetLatestLogContent.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.GetLatestLogContent.key],
        onSuccess: async data => {
            if (!data) return toast.error("Couldn't fetch logs")
            try {
                // await copyToClipboard(data)
                toast.success("Copied to clipboard")
            }
            catch (err: unknown) {
                if (__DEV__) {
                    console.error("Clipboard write error:", err)
                }

                const errorMessage = err instanceof Error ? err.message : "Unknown clipboard error"
                toast.error("Failed to copy logs: " + errorMessage)
            }
        },
    })
}

export function useGetAnnouncements() {
    return useServerMutation<Array<Updater_Announcement>, GetAnnouncements_Variables>({
        endpoint: API_ENDPOINTS.STATUS.GetAnnouncements.endpoint,
        method: API_ENDPOINTS.STATUS.GetAnnouncements.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.GetAnnouncements.key],
    })
}

// Memory profiling hooks

export function useGetMemoryStats() {
    return useServerQuery<MemoryStatsResponse>({
        endpoint: API_ENDPOINTS.STATUS.GetMemoryStats.endpoint,
        method: API_ENDPOINTS.STATUS.GetMemoryStats.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetMemoryStats.key],
        enabled: false, // Manual trigger only
        refetchInterval: false,
    })
}

export function useForceGC() {
    const qc = useQueryClient()
    return useServerMutation<MemoryStatsResponse>({
        endpoint: API_ENDPOINTS.STATUS.ForceGC.endpoint,
        method: API_ENDPOINTS.STATUS.ForceGC.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.ForceGC.key],
        onSuccess: async () => {
            // Invalidate and refetch memory stats after GC
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetMemoryStats.key] })
            toast.success("Garbage collection completed")
        },
    })
}

export function useGetHomeItems() {
    return useServerQuery<Array<Models_HomeItem>>({
        endpoint: API_ENDPOINTS.STATUS.GetHomeItems.endpoint,
        method: API_ENDPOINTS.STATUS.GetHomeItems.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetHomeItems.key],
        enabled: true,
    })
}

export function useUpdateHomeItems() {
    const qc = useQueryClient()
    return useServerMutation<null, UpdateHomeItems_Variables>({
        endpoint: API_ENDPOINTS.STATUS.UpdateHomeItems.endpoint,
        method: API_ENDPOINTS.STATUS.UpdateHomeItems.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.UpdateHomeItems.key],
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetHomeItems.key] })
            toast.success("Home screen updated")
        },
    })
}

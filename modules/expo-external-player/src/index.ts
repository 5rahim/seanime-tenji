import ExpoExternalPlayerModule from "./ExpoExternalPlayerModule"

export type { ExpoExternalPlayerModuleType } from "./ExpoExternalPlayer.types"

export const ExpoExternalPlayer = {
    open(url: string, packageName: string | null): Promise<boolean> {
        return ExpoExternalPlayerModule?.open(url, packageName) ?? Promise.resolve(false)
    },

    openFile(url: string, packageName?: string | null): Promise<boolean> {
        if (!ExpoExternalPlayerModule?.openFile) return Promise.resolve(false)

        return packageName === undefined
            ? ExpoExternalPlayerModule.openFile(url)
            : ExpoExternalPlayerModule.openFile(url, packageName)
    },
}

export default ExpoExternalPlayer

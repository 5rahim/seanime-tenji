export type ExpoExternalPlayerModuleType = {
    open(url: string, packageName: string | null): Promise<boolean>
    openFile?(url: string, packageName?: string | null): Promise<boolean>
}

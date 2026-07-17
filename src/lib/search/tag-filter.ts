export type MediaTag = {
    id: number
    name: string
    category: string
    isAdult: boolean
    popularity: number
}

export function filterMediaTags(
    tags: readonly MediaTag[],
    search: string,
    allowAdult: boolean,
    selected: readonly string[],
    limit: number = 12,
): MediaTag[] {
    const query = search.trim().toLowerCase()
    const selectedSet = new Set(selected)

    return tags
        .filter(tag => allowAdult || !tag.isAdult)
        .filter(tag => !selectedSet.has(tag.name))
        .filter(tag => !query || tag.name.toLowerCase().includes(query) || tag.category.toLowerCase().includes(query))
        .sort((a, b) => {
            const aName = a.name.toLowerCase()
            const bName = b.name.toLowerCase()
            const aMatch = !query ? 0 : aName.startsWith(query) ? 0 : aName.includes(query) ? 1 : 2
            const bMatch = !query ? 0 : bName.startsWith(query) ? 0 : bName.includes(query) ? 1 : 2
            return aMatch - bMatch || b.popularity - a.popularity || a.name.localeCompare(b.name)
        })
        .slice(0, Math.max(0, limit))
}

export function removeAdultTags(selected: readonly string[], tags: readonly MediaTag[]): string[] {
    const adult = new Set(tags.filter(tag => tag.isAdult).map(tag => tag.name))
    return selected.filter(tag => !adult.has(tag))
}

export function hasMediaTags(
    mediaId: number | undefined,
    selected: readonly string[],
    tagMap: Record<number, readonly string[]> | null | undefined,
): boolean {
    if (!selected.length || !tagMap) return true
    if (mediaId === undefined) return false

    const tags = tagMap[mediaId] ?? []
    return selected.every(tag => tags.includes(tag))
}

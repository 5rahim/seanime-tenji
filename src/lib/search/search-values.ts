export function parseMinScore(value: string | null): number | undefined {
    if (!value) return undefined
    const score = Number.parseInt(value, 10)
    return score >= 1 && score <= 9 ? score : undefined
}

export function getAnimeMinScore(value: string | null): number | undefined {
    const score = parseMinScore(value)
    return score === undefined ? undefined : score * 10
}

export function getMangaMinScore(value: string | null): number | undefined {
    return parseMinScore(value)
}

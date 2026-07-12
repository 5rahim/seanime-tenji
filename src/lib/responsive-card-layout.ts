const HORIZONTAL_MEDIA_CARD_WIDTH_RATIO = 2 / 5
const HORIZONTAL_MEDIA_CARD_MAX_WIDTH = 184

const EPISODE_CARD_WIDTH_RATIO = 3.5 / 5
const EPISODE_CARD_MAX_WIDTH = 500

const DEFAULT_GRID_MIN_COLUMNS = 3
const DEFAULT_GRID_MAX_COLUMNS = 10
const DEFAULT_GRID_MAX_CARD_WIDTH = 184

type MediaGridLayoutOptions = {
    screenWidth: number
    horizontalPadding: number
    spacing: number
    minColumns?: number
    maxColumns?: number
    maxCardWidth?: number
}

type HorizontalCardRenderCountOptions = {
    viewportWidth: number
    cardWidth: number
    spacing: number
    horizontalPadding: number
    overscan?: number
}

export function getHorizontalMediaCardWidth(screenWidth: number) {
    return Math.max(1, Math.floor(Math.min(screenWidth * HORIZONTAL_MEDIA_CARD_WIDTH_RATIO, HORIZONTAL_MEDIA_CARD_MAX_WIDTH)))
}

export function getHorizontalMediaCardRowHeight(cardWidth: number) {
    return cardWidth * 1.5 + 16
}

export function getHorizontalCardRenderCount({
    viewportWidth,
    cardWidth,
    spacing,
    horizontalPadding,
    overscan = 1,
}: HorizontalCardRenderCountOptions) {
    const availableWidth = Math.max(0, viewportWidth - 2 * horizontalPadding)
    const itemFullWidth = Math.max(1, cardWidth + spacing)
    const visibleItemCount = Math.max(1, Math.ceil((availableWidth + spacing) / itemFullWidth))

    return visibleItemCount + Math.max(0, overscan)
}

export function getEpisodeCardWidth(screenWidth: number) {
    return Math.max(1, Math.floor(Math.min(screenWidth * EPISODE_CARD_WIDTH_RATIO, EPISODE_CARD_MAX_WIDTH)))
}

export function getEpisodeCardRowHeight(cardWidth: number) {
    return Math.ceil(cardWidth * (9 / 16) + 60)
}

export function getMediaGridLayout({
    screenWidth,
    horizontalPadding,
    spacing,
    minColumns = DEFAULT_GRID_MIN_COLUMNS,
    maxColumns = DEFAULT_GRID_MAX_COLUMNS,
    maxCardWidth = DEFAULT_GRID_MAX_CARD_WIDTH,
}: MediaGridLayoutOptions) {
    const availableWidth = Math.max(0, screenWidth - 2 * horizontalPadding)
    const preferredColumns = Math.ceil((availableWidth + spacing) / (maxCardWidth + spacing))
    const numColumns = Math.min(maxColumns, Math.max(minColumns, preferredColumns || minColumns))
    const cardWidth = Math.floor((availableWidth - (numColumns - 1) * spacing) / numColumns)

    return {
        cardWidth: Math.max(1, cardWidth),
        numColumns,
    }
}

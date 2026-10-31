import assert from "node:assert/strict"
import test from "node:test"
import {
    canDownloadMissingEpisodes,
    torrentConfirmAction,
} from "../src/components/features/torrentstream/torrent-stream-picker-utils.ts"

const batch = { isBatch: true } as any
const single = { isBatch: false } as any

function entry(missing: number, media: Record<string, unknown> = {}) {
    return {
        media: { format: "TV", status: "FINISHED", episodes: 12, ...media },
        downloadInfo: { episodesToDownload: Array.from({ length: missing }, (_, i) => ({ episodeNumber: i + 1 })) },
    } as any
}

test("download mode doesnt start a stream", () => {
    assert.equal(torrentConfirmAction("download", batch, true), "pick-file")
    assert.equal(torrentConfirmAction("download", batch, false), "pick-file")
    assert.equal(torrentConfirmAction("download", single, true), "none")
    assert.equal(torrentConfirmAction("download", null, true), "none")
})

test("stream mode keeps its selection behavior", () => {
    assert.equal(torrentConfirmAction("stream", null, true), "auto-stream")
    assert.equal(torrentConfirmAction("stream", batch, true), "stream")
    assert.equal(torrentConfirmAction("stream", batch, false), "pick-file")
    assert.equal(torrentConfirmAction("stream", single, false), "stream")
})

test("missing episodes can be downloaded from a finished series with some episodes present", () => {
    assert.equal(canDownloadMissingEpisodes(entry(4)), true)
})

test("missing episodes are unavailable when the server cannot select them", () => {
    assert.equal(canDownloadMissingEpisodes(entry(0)), false)
    assert.equal(canDownloadMissingEpisodes(entry(12)), false)
    assert.equal(canDownloadMissingEpisodes(entry(4, { status: "RELEASING" })), false)
    assert.equal(canDownloadMissingEpisodes(entry(1, { format: "MOVIE", episodes: 1 })), false)
})

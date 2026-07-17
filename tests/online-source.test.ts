import assert from "node:assert/strict"
import test from "node:test"
import { switchOnlineSource, toSourceFromOnlineStream } from "../src/lib/player/source-resolver.ts"

const sources = [
    {
        server: "Alpha",
        url: "https://example.com/alpha.m3u8",
        quality: "720p",
        type: "m3u8" as const,
    },
    {
        server: "Beta",
        url: "https://example.com/beta.mp4",
        quality: "1080p",
        type: "mp4" as const,
        headers: { Referer: "https://example.com" },
        subtitles: [{ url: "https://example.com/en.vtt", language: "English", isDefault: true }],
    },
]

test("online playback keeps all episode sources", () => {
    const source = toSourceFromOnlineStream({
        videoSource: sources[0],
        videoSources: sources,
        mediaId: 1,
        episodeNumber: 2,
    })

    assert.equal(source.onlineSources?.length, 2)
    assert.equal(source.onlineSource?.url, sources[0].url)
    assert.equal(source.streamKind, "hls")
})

test("switching source keeps position and applies source metadata", () => {
    const current = toSourceFromOnlineStream({
        videoSource: sources[0],
        videoSources: sources,
        mediaId: 1,
        episodeNumber: 2,
    })
    const next = switchOnlineSource(current, sources[1], 123.5)

    assert.notEqual(next.id, current.id)
    assert.equal(next.url, sources[1].url)
    assert.equal(next.streamKind, "http")
    assert.equal(next.resumePositionSec, 123.5)
    assert.deepEqual(next.headers, sources[1].headers)
    assert.deepEqual(next.externalSubtitles, sources[1].subtitles)
    assert.equal(next.onlineSources, current.onlineSources)
})

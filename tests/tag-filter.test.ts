import assert from "node:assert/strict"
import test from "node:test"
import { filterMediaTags, hasMediaTags, type MediaTag, removeAdultTags } from "../src/lib/search/tag-filter.ts"

const tags: MediaTag[] = [
    { id: 1, name: "Action", category: "Genre", isAdult: false, popularity: 40 },
    { id: 2, name: "Space", category: "Setting", isAdult: false, popularity: 90 },
    { id: 3, name: "Space Opera", category: "Theme", isAdult: false, popularity: 70 },
    { id: 4, name: "Adult Cast", category: "Cast", isAdult: true, popularity: 100 },
]

test("tag search hides adult and already selected tags", () => {
    const result = filterMediaTags(tags, "", false, ["Action"])
    assert.deepEqual(result.map(tag => tag.name), ["Space", "Space Opera"])
})

test("empty tag search shows popular tags first", () => {
    const result = filterMediaTags(tags, "", false, [])
    assert.deepEqual(result.map(tag => tag.name), ["Space", "Space Opera", "Action"])
})

test("tag search is limited and prefers names starting with the query", () => {
    const result = filterMediaTags(tags, "space", true, [], 1)
    assert.deepEqual(result.map(tag => tag.name), ["Space"])
})

test("disabling adult search removes saved adult tags", () => {
    assert.deepEqual(removeAdultTags(["Action", "Adult Cast"], tags), ["Action"])
})

test("collection entries must have every selected tag", () => {
    const tagMap = {
        1: ["Action", "Space"],
        2: ["Space"],
    }

    assert.equal(hasMediaTags(1, ["Action", "Space"], tagMap), true)
    assert.equal(hasMediaTags(2, ["Action", "Space"], tagMap), false)
    assert.equal(hasMediaTags(undefined, ["Space"], tagMap), false)
    assert.equal(hasMediaTags(1, [], tagMap), true)
})

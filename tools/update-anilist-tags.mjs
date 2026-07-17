import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const query = `query MobileTagCatalog {
  MediaTagCollection {
    id
    name
    category
    isAdult
  }
  anime: Page(page: 1, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      tags {
        id
        rank
      }
    }
  }
  manga: Page(page: 1, perPage: 50) {
    media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
      tags {
        id
        rank
      }
    }
  }
}`

const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query }),
})

if (!response.ok) throw new Error(`AniList returned ${response.status}`)

const body = await response.json()
if (body.errors?.length) throw new Error(body.errors.map(error => error.message).join(", "))

const tags = body.data?.MediaTagCollection
if (!Array.isArray(tags)) throw new Error("AniList did not return a tag catalog")

const weight = new Map()
const media = [...(body.data?.anime?.media ?? []), ...(body.data?.manga?.media ?? [])]
for (const item of media) {
    for (const tag of item?.tags ?? []) {
        if (typeof tag?.id !== "number" || typeof tag?.rank !== "number") continue
        weight.set(tag.id, (weight.get(tag.id) ?? 0) + tag.rank)
    }
}

const output = tags
    .map(({ id, name, category, isAdult }) => ({
        id,
        name,
        category,
        isAdult: !!isAdult,
        popularity: weight.get(id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const target = path.join(root, "src/lib/search/media-tags.json")
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${output.length} tags to ${target}`)

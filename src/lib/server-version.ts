import { MIN_SERVER_VERSION } from "@/lib/constants"

export { MIN_SERVER_VERSION }

type ParsedVersion = {
    major: number
    minor: number
    patch: number
    prerelease: string[]
}

function parseServerVersion(value: string | null | undefined): ParsedVersion | null {
    if (!value) return null

    const [withoutBuild] = value.trim().replace(/^v/i, "").split("+")
    const [core, prerelease = ""] = withoutBuild.split("-")
    const [major, minor = "0", patch = "0"] = core.split(".")
    const parsedMajor = Number(major)
    const parsedMinor = Number(minor)
    const parsedPatch = Number(patch)

    if (!Number.isInteger(parsedMajor) || !Number.isInteger(parsedMinor) || !Number.isInteger(parsedPatch)) {
        return null
    }

    return {
        major: parsedMajor,
        minor: parsedMinor,
        patch: parsedPatch,
        prerelease: prerelease ? prerelease.split(".") : [],
    }
}

function comparePrerelease(left: string[], right: string[]): number {
    if (left.length === 0 && right.length === 0) return 0
    if (left.length === 0) return 1
    if (right.length === 0) return -1

    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index++) {
        const leftPart = left[index]
        const rightPart = right[index]

        if (leftPart === undefined) return -1
        if (rightPart === undefined) return 1
        if (leftPart === rightPart) continue

        const leftNumber = Number(leftPart)
        const rightNumber = Number(rightPart)
        const leftIsNumber = Number.isInteger(leftNumber)
        const rightIsNumber = Number.isInteger(rightNumber)

        if (leftIsNumber && rightIsNumber) return Math.sign(leftNumber - rightNumber)
        if (leftIsNumber) return -1
        if (rightIsNumber) return 1

        return Math.sign(leftPart.localeCompare(rightPart))
    }

    return 0
}

export function compareServerVersions(left: string | null | undefined, right: string | null | undefined): number | null {
    const parsedLeft = parseServerVersion(left)
    const parsedRight = parseServerVersion(right)

    if (!parsedLeft || !parsedRight) return null

    const coreDifference = parsedLeft.major - parsedRight.major
        || parsedLeft.minor - parsedRight.minor
        || parsedLeft.patch - parsedRight.patch

    if (coreDifference !== 0) return Math.sign(coreDifference)

    return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

export function isServerVersionSupported(version: string | null | undefined): boolean {
    const comparison = compareServerVersions(version, MIN_SERVER_VERSION)

    return comparison !== null && comparison >= 0
}

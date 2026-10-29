#!/usr/bin/env python3
"""
Patches the prebuilt mpv-android (2026-03-22 release) JNI libraries (libmpv.so and libavcodec.so)
for Android TV zero-copy MediaCodec (AImageReader) playback on Amlogic / Mali-G31 SoCs:

1. libmpv.so (video/out/opengl/hwdec_aimagereader.c):
   - Lower AImageReader_newWithUsage(..., maxImages) from 3 to 2 so BufferQueue reserves
     fewer output buffers from constrained hardware decoder pools (e.g. Amlogic 4kosd 14-buffer cap).
   - Call gl->Finish() at the start of mapper_unmap() before eglDestroyImageKHR() and AImage_delete()
     so Tile-Based Deferred Rendering (TBDR) GPUs (ARM Mali-G31) finish sampling the external OES
     texture before the AHardwareBuffer is returned to the MediaCodec output queue without a sync fence.

2. libavcodec.so (libavcodec/mediacodecdec.c):
   - Pass wait=true (1) to ff_mediacodec_dec_receive() in mediacodec_receive_frame() so FFmpeg
     uses an 8ms dequeue timeout once decoding has started instead of a 0us poll that floods
     AMediaCodec_queueInputBuffer and starves the hardware H.264 DPB reference frame pool.
"""

from pathlib import Path
import struct
import sys


def apply_patch(buf: bytearray, offset: int, expected: bytes, replacement: bytes, desc: str) -> None:
    actual = bytes(buf[offset : offset + len(expected)])
    if actual == replacement:
        print(f"  [skip] {desc} (already patched)")
        return
    if actual != expected:
        raise RuntimeError(
            f"Byte mismatch for {desc} at 0x{offset:x}: "
            f"expected {expected.hex()}, found {actual.hex()}"
        )
    buf[offset : offset + len(replacement)] = replacement
    print(f"  [ok]   {desc}")


def patch_armeabi_v7a(jni_dir: Path) -> None:
    mpv_path = jni_dir / "armeabi-v7a" / "libmpv.so"
    avc_path = jni_dir / "armeabi-v7a" / "libavcodec.so"

    if mpv_path.is_file():
        print(f"Patching {mpv_path}...")
        buf = bytearray(mpv_path.read_bytes())
        # 1. AImageReader_newWithUsage maxImages = 2 (mov r3, #3 -> mov r3, #2)
        apply_patch(
            buf,
            0x2A5D78,
            bytes.fromhex("0330a0e3"),
            bytes.fromhex("0230a0e3"),
            "armeabi-v7a libmpv.so: AImageReader maxImages 3 -> 2",
        )
        # 2. mapper_unmap: call gl->Finish() before eglDestroyImageKHR / AImage_delete
        trampoline = b"".join(
            struct.pack("<I", insn)
            for insn in [
                0xE5903008,  # ldr r3, [r0, #8]      ; r3 = mapper->ra
                0xE5933020,  # ldr r3, [r3, #0x20]   ; r3 = ra_gl->gl
                0xE5933044,  # ldr r3, [r3, #0x44]   ; r3 = gl->Finish
                0xE12FFF33,  # blx r3                ; gl->Finish()
                0xE5940020,  # ldr r0, [r4, #0x20]   ; r0 = mapper->priv
                0xEA000018,  # b 0x2a6654            ; resume mapper_unmap
            ]
        )
        apply_patch(
            buf,
            0x2A65DC,
            bytes.fromhex("300000ea00482de90da0a0e1000000ea94d04de204b08de2"),
            trampoline,
            "armeabi-v7a libmpv.so: gl->Finish() trampoline",
        )
        apply_patch(
            buf,
            0x2A6650,
            bytes.fromhex("200094e5"),
            struct.pack("<I", 0xEAFFFFE1),  # b 0x2a65dc
            "armeabi-v7a libmpv.so: mapper_unmap branch to gl->Finish()",
        )
        mpv_path.write_bytes(buf)

    if avc_path.is_file():
        print(f"Patching {avc_path}...")
        buf = bytearray(avc_path.read_bytes())
        # mediacodec_receive_frame: ff_mediacodec_dec_receive(..., wait=1)
        apply_patch(
            buf,
            0x6CDDE0,
            bytes.fromhex("0030a0e3"),
            bytes.fromhex("0130a0e3"),
            "armeabi-v7a libavcodec.so: mediacodec_receive_frame wait=true",
        )
        avc_path.write_bytes(buf)


def patch_arm64_v8a(jni_dir: Path) -> None:
    mpv_path = jni_dir / "arm64-v8a" / "libmpv.so"
    avc_path = jni_dir / "arm64-v8a" / "libavcodec.so"

    if mpv_path.is_file():
        print(f"Patching {mpv_path}...")
        buf = bytearray(mpv_path.read_bytes())
        # 1. AImageReader_newWithUsage maxImages = 2 (mov w3, #3 -> mov w3, #2)
        apply_patch(
            buf,
            0x357054,
            bytes.fromhex("63008052"),
            bytes.fromhex("43008052"),
            "arm64-v8a libmpv.so: AImageReader maxImages 3 -> 2",
        )
        # 2. mapper_unmap: call gl->Finish() before eglDestroyImageKHR / AImage_delete
        trampoline = b"".join(
            struct.pack("<I", insn)
            for insn in [
                0xF9400808,  # ldr x8, [x0, #0x10]   ; x8 = mapper->ra
                0xF9401508,  # ldr x8, [x8, #0x28]   ; x8 = ra_gl->gl
                0xF9403D08,  # ldr x8, [x8, #0x78]   ; x8 = gl->Finish
                0xD63F0100,  # blr x8                ; gl->Finish()
                0xA94227E8,  # ldp x8, x9, [sp, #0x20]
                0x14000011,  # b 0x357858            ; resume mapper_unmap
            ]
        )
        apply_patch(
            buf,
            0x357800,
            bytes.fromhex("0b000014ff4300d1f30300aa09000014ff8300d1f44f01a9"),
            trampoline,
            "arm64-v8a libmpv.so: gl->Finish() trampoline",
        )
        apply_patch(
            buf,
            0x357854,
            bytes.fromhex("e82742a9"),
            struct.pack("<I", 0x17FFFFEB),  # b 0x357800
            "arm64-v8a libmpv.so: mapper_unmap branch to gl->Finish()",
        )
        mpv_path.write_bytes(buf)

    if avc_path.is_file():
        print(f"Patching {avc_path}...")
        buf = bytearray(avc_path.read_bytes())
        # mediacodec_receive_frame: ff_mediacodec_dec_receive(..., wait=1)
        apply_patch(
            buf,
            0x75FBD8,
            bytes.fromhex("e3031f2a"),
            bytes.fromhex("23008052"),
            "arm64-v8a libavcodec.so: mediacodec_receive_frame wait=true",
        )
        avc_path.write_bytes(buf)


def main() -> int:
    jni_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    patch_armeabi_v7a(jni_dir)
    patch_arm64_v8a(jni_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

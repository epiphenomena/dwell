# Rasterizes the app icon (three ribbons on a page) to PNG without PIL.
import struct, zlib

def png(path, size, maskable=False):
    s = size / 512
    bg = (0x11, 0x12, 0x14); page = (0x1f, 0x21, 0x24)
    ribbons = [((196, 224, 396), (0xef, 0x5b, 0x4f)), ((242, 270, 356), (0xf2, 0xd1, 0x4e)), ((288, 316, 426), (0x46, 0xcf, 0xc4))]
    r = 0 if maskable else 112
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            x, y = (px + .5) / s, (py + .5) / s
            # rounded-rect background with alpha outside corners
            cx = min(max(x, r), 512 - r); cy = min(max(y, r), 512 - r)
            inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
            col, a = bg, 255 if inside else 0
            if inside and 150 <= x <= 362 and 96 <= y <= 416: col = page
            for (x0, x1, y1), c in ribbons:
                # ribbon with a V notch cut into its tail
                mid = (x0 + x1) / 2
                if x0 <= x <= x1 and 96 <= y <= y1 + abs(x - mid) * 16 / 14:
                    col = c
            row += bytes(col) + bytes([a])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

png('icons/icon-192.png', 192)
png('icons/icon-512.png', 512)
png('icons/icon-maskable-512.png', 512, maskable=True)

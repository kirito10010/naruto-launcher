#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解压 SWF(FWS/CWS/ZWS) 并提取可读字符串。
用法: python tools/swf_extract.py <xxx.swf> [输出前缀]
      会生成 <前缀>.fws.swf (解压后的 SWF) 与 <前缀>.strings.txt
"""
import sys, os, zlib, lzma, struct, re


def swf_body(d: bytes) -> bytes:
    sig = d[:3]
    if sig == b'FWS':
        return d[8:]
    if sig == b'CWS':
        return zlib.decompress(d[8:])
    if sig == b'ZWS':
        props = d[8]
        dict_size = struct.unpack('<I', d[9:13])[0]
        lc = props % 9
        rest = props // 9
        lp = rest % 5
        pb = rest // 5
        filters = [{'id': lzma.FILTER_LZMA1, 'dict_size': dict_size,
                    'lc': lc, 'lp': lp, 'pb': pb}]
        dec = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=filters)
        return dec.decompress(d[13:])
    raise ValueError('unknown swf signature: %r' % sig)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    prefix = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(path)[0]
    d = open(path, 'rb').read()
    sig = d[:3].decode('latin1')
    version = d[3]
    body = swf_body(d)
    print('%s  sig=%s v=%d  解压后=%d B' % (os.path.basename(path), sig, version, len(body)))

    # 输出解压后的 FWS
    fws = bytearray()
    fws += b'FWS'
    fws.append(version)
    fws += struct.pack('<I', 8 + len(body))
    fws += body
    open(prefix + '.fws.swf', 'wb').write(fws)

    # 提取字符串
    strs = [m.group().decode('latin1') for m in re.finditer(rb'[\x20-\x7e]{4,}', body)]
    open(prefix + '.strings.txt', 'w', encoding='utf-8', errors='replace').write('\n'.join(strs))
    print('  字符串数=%d -> %s.strings.txt' % (len(strs), prefix))


if __name__ == '__main__':
    main()

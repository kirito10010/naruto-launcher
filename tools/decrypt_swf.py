#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""复现 entry.swf 的 util.decryptSWF，还原被混淆的 ZWS 游戏 SWF。

用法: python tools/decrypt_swf.py <in.swf> <out.swf>

decryptSWF 逻辑(来自反编译 util/decryptSWF.as):
  1. 校验头: 'ZWS' + version==0 + 长度==0xFFFFFFFF
  2. 取其后 11 字节, 奇数位(0-based: 0,2,4,6,8,10)入 A(6字节), 其余入 B(5字节)
  3. 输出 = 3 字节(A 两两低半字节拼: (A[i]&0xF) | ((A[i+1]&0xF)<<4)) + B(5字节)
  4. 再取 min(128, 剩余) 字节, 奇数下标取反(~), 偶数下标原样
  5. 其余字节原样追加
"""
import sys, lzma, struct


def decrypt_swf(data: bytes) -> bytes:
    if len(data) <= 8:
        return data
    if data[0:3] != b'ZWS':
        return data
    if data[3] != 0:
        return data
    if struct.unpack('<I', data[4:8])[0] != 0xFFFFFFFF:
        return data

    pos = 8
    A = bytearray()
    B = bytearray()
    flag = 1
    for _ in range(11):
        if pos >= len(data):
            break
        if flag:
            A.append(data[pos])
        else:
            B.append(data[pos])
        flag ^= 1
        pos += 1

    out = bytearray()
    i = 0
    while i + 1 < len(A):
        out.append((A[i] & 0x0F) | ((A[i + 1] & 0x0F) << 4))
        i += 2
    out += B

    n = min(128, len(data) - pos)
    for k in range(n):
        b = data[pos]
        pos += 1
        out.append((~b) & 0xFF if (k & 1) else b)

    out += data[pos:]
    return bytes(out)


def lzma_try(body: bytes):
    """在若干偏移尝试 LZMA(5 字节 props 头), 返回 (offset, 解压结果)"""
    for off in (0, 5, 8, 12, 13, 16):
        if len(body) < off + 5:
            continue
        props = body[off]
        ds = struct.unpack('<I', body[off + 1:off + 5])[0]
        lc = props % 9
        rest = props // 9
        lp = rest % 5
        pb = rest // 5
        if lp > 4 or pb > 4:
            continue
        try:
            dec = lzma.LZMADecompressor(format=lzma.FORMAT_RAW,
                                        filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': ds,
                                                  'lc': lc, 'lp': lp, 'pb': pb}])
            r = dec.decompress(body[off + 5:])
            if len(r) > 100:
                return (off, props, ds, lc, lp, pb, r)
        except Exception:
            pass
    return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    d = open(src, 'rb').read()
    body = decrypt_swf(d)
    print('input %d B -> decrypted %d B' % (len(d), len(body)))
    print('decrypted head32:', body[:32].hex())

    r = lzma_try(body)
    if r:
        off, props, ds, lc, lp, pb, dec = r
        print('LZMA ok @off=%d props=0x%02x dict=%d lc=%d lp=%d pb=%d -> %d B, head=%s'
              % (off, props, ds, lc, lp, pb, len(dec), dec[:16].hex()))
        if dec[:3] in (b'FWS', b'CWS', b'ZWS'):
            open(dst, 'wb').write(dec)
            print('wrote SWF ->', dst)
        else:
            fws = bytearray(b'FWS')
            fws.append(13)
            fws += struct.pack('<I', 8 + len(dec))
            fws += dec
            open(dst, 'wb').write(fws)
            print('wrote FWS-wrapped ->', dst)
    else:
        print('LZMA: 所有偏移均失败')


if __name__ == '__main__':
    main()

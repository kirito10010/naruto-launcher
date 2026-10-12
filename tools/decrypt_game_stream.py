#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解密并解析火影OL 游戏 TCP 流载荷 (腾讯 TEA, 静态密钥 d796c2542916b456)。

用法: python tools/decrypt_game_stream.py <sockets/xxxx-rx.bin> <cmd[,cmd2...]>

协议: 36 字节头 + 载荷
  头: magic(2)=0x0901 len(2,BE) cmdId(4,BE) index(4,BE) type(4,BE) 0(8) uin(4) role(2) serId(2) 0(4)
  载荷: 明文 Protobuf (type=3) 或 TEA 加密 (type=2)

TEA 解密 (来自反编译 com.tencent.morefun.naruto.plugin.server.encrypt.TEALib):
  ROUNDS=16 DELTA=0x9E3779B9 SALT_LEN=2 ZERO_LEN=7, key = KeyChain.key = "d796c2542916b456"
  明文 = [头字节(低3位=pad)] [pad 随机] [2 salt] [数据] [7 个 0], 补到 8 的倍数
  链: P_i = TEA_dec(P_{i-1} ^ C_i), 输出 = P_i ^ C_{i-1}
"""
import struct, sys, json

DELTA = 0x9E3779B9
ROUNDS = 16
SALT_LEN = 2
ZERO_LEN = 7
M = 0xFFFFFFFF
KEY = b'd796c2542916b456'
HDR = 36


def tea_dec8(block, k):
    v0, v1 = struct.unpack('>II', block)
    s = (DELTA << 4) & M
    for _ in range(ROUNDS):
        v1 = (v1 - ((((v0 << 4) & M) + k[2] & M) ^ ((v0 + s) & M) ^ (((v0 >> 5) + k[3]) & M))) & M
        v0 = (v0 - ((((v1 << 4) & M) + k[0] & M) ^ ((v1 + s) & M) ^ (((v1 >> 5) + k[1]) & M))) & M
        s = (s - DELTA) & M
    return struct.pack('>II', v0, v1)


def xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def tea_decrypt(data, k):
    """QQ+CBC 变体"""
    bs = [data[i:i + 8] for i in range(0, len(data), 8)]
    p = tea_dec8(bs[0], k)
    out = p
    for i in range(1, len(bs)):
        p = tea_dec8(xor(p, bs[i]), k)
        out += xor(p, bs[i - 1])
    return out


def strip(full, total):
    pad = full[0] & 7
    outlen = total - 1 - pad - SALT_LEN - ZERO_LEN
    if outlen < 0:
        return None
    return full[1 + pad + SALT_LEN:1 + pad + SALT_LEN + outlen]


# ---------- protobuf ----------
def read_varint(b, i):
    r = 0
    s = 0
    while i < len(b):
        x = b[i]
        i += 1
        r |= (x & 0x7f) << s
        if not (x & 0x80):
            return r, i
        s += 7
    raise ValueError('eof')


def pb_walk(b, depth=0, maxdepth=6):
    i = 0
    out = []
    while i < len(b):
        key, i = read_varint(b, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = read_varint(b, i)
            out.append((fn, 'int', v))
        elif wt == 2:
            ln, i = read_varint(b, i)
            d = b[i:i + ln]
            i += ln
            out.append((fn, 'len', d))
        elif wt == 5:
            out.append((fn, 'f32', struct.unpack('<I', b[i:i + 4])[0]))
            i += 4
        elif wt == 1:
            out.append((fn, 'f64', struct.unpack('<Q', b[i:i + 8])[0]))
            i += 8
        else:
            break
    return out


def show(b, indent=0, maxdepth=6, budget=None):
    if budget is None:
        budget = {'n': 150}
    pad = '  ' * indent
    for fn, kind, v in pb_walk(b):
        if budget['n'] <= 0:
            return
        budget['n'] -= 1
        if kind == 'int':
            print('%sf%d = %d' % (pad, fn, v))
        elif kind == 'len':
            s = v.decode('utf-8', 'replace')
            printable = sum(1 for c in s if ' ' <= c <= '~' or ord(c) > 127)
            if v and printable / len(s) > 0.8 and len(v) < 200:
                print('%sf%d = "%s"' % (pad, fn, s))
            elif indent < maxdepth:
                print('%sf%d = {' % (pad, fn))
                try:
                    show(v, indent + 1, maxdepth, budget)
                except Exception:
                    print('%s  <%d bytes>' % (pad, len(v)))
                print('%s}' % pad)
            else:
                print('%sf%d = <%d bytes>' % (pad, fn, len(v)))
        else:
            print('%sf%d = %s' % (pad, fn, v))


def parse_frames(d):
    out = []
    off = 0
    while off + HDR <= len(d):
        if d[off] != 0x09 or d[off + 1] != 0x01:
            off += 1
            continue
        ln = struct.unpack('>H', d[off + 2:off + 4])[0]
        if off + HDR + ln > len(d):
            break
        cmd = struct.unpack('>I', d[off + 4:off + 8])[0]
        idx = struct.unpack('>I', d[off + 8:off + 12])[0]
        typ = struct.unpack('>I', d[off + 12:off + 16])[0]
        out.append((cmd, idx, typ, d[off + HDR:off + HDR + ln]))
        off += HDR + ln
    return out


def main():
    d = open(sys.argv[1], 'rb').read()
    k = struct.unpack('>IIII', KEY)
    if len(sys.argv) > 2 and sys.argv[2] == 'list':
        from collections import Counter
        c = Counter()
        sizes = {}
        for cmd, idx, typ, p in parse_frames(d):
            c[cmd] += 1
            sizes[cmd] = max(sizes.get(cmd, 0), len(p))
        for cmd, n in c.most_common():
            print('cmd=%-8d 帧数=%-4d 最大载荷=%d' % (cmd, n, sizes[cmd]))
        return
    want = set(int(x) for x in sys.argv[2].split(','))
    for cmd, idx, typ, p in parse_frames(d):
        if cmd not in want or not p:
            continue
        print('\n########## cmd=%d idx=%d type=%d len=%d ##########' % (cmd, idx, typ, len(p)))
        if typ == 3:
            plain = p
        elif len(p) % 8 == 0 and len(p) >= 16:
            plain = strip(tea_decrypt(p, k), len(p))
        else:
            print('  (跳过: 长度 %d)' % len(p))
            continue
        if plain is None:
            print('  (解密失败)')
            continue
        print('  明文 %d 字节' % len(plain))
        show(plain)


if __name__ == '__main__':
    main()

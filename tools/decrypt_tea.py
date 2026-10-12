import struct, sys

DELTA = 0x9E3779B9
ROUNDS = 16
SALT_LEN = 2
ZERO_LEN = 7
M = 0xFFFFFFFF


def tea_dec8(block, k):
    v0, v1 = struct.unpack('>II', block)
    s = (DELTA << 4) & M
    for _ in range(ROUNDS):
        v1 = (v1 - ((((v0 << 4) & M) + k[2] & M) ^ ((v0 + s) & M) ^ (((v0 >> 5) + k[3]) & M))) & M
        v0 = (v0 - ((((v1 << 4) & M) + k[0] & M) ^ ((v1 + s) & M) ^ (((v1 >> 5) + k[1]) & M))) & M
        s = (s - DELTA) & M
    return struct.pack('>II', v0, v1)


def blocks_of(data):
    return [data[i:i + 8] for i in range(0, len(data), 8)]


def xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def strip(plain, total_len):
    """按 QQ TEA 格式剥离头/pad/salt/尾部0, 返回明文"""
    pad = plain[0] & 7
    outlen = total_len - 1 - pad - SALT_LEN - ZERO_LEN
    if outlen < 0:
        return None
    start = 1 + pad + SALT_LEN
    return plain[start:start + outlen]


def v_cbc(data, k):
    prev = b'\x00' * 8
    out = b''
    for b in blocks_of(data):
        out += xor(tea_dec8(b, k), prev)
        prev = b
    return out


def v_qq(data, k):
    """P_i = TEA_dec(P_{i-1} ^ C_i)"""
    bs = blocks_of(data)
    p = tea_dec8(bs[0], k)
    outs = [p]
    for i in range(1, len(bs)):
        p = tea_dec8(xor(p, bs[i]), k)
        outs.append(p)
    return b''.join(outs)


def v_qq_cbc(data, k):
    """P_i = TEA_dec(P_{i-1} ^ C_i), out = P_i ^ C_{i-1}"""
    bs = blocks_of(data)
    p = tea_dec8(bs[0], k)
    out = p
    prev_c = b'\x00' * 8
    for i in range(1, len(bs)):
        p = tea_dec8(xor(p, bs[i]), k)
        out += xor(p, bs[i - 1])
    return out


def valid_proto(b):
    if not b:
        return False
    wt = b[0] & 7
    return wt in (0, 1, 2, 5)


def main():
    key = b'd796c2542916b456'
    k = struct.unpack('>IIII', key)
    data = open(sys.argv[1], 'rb').read()
    print('cipher len', len(data), 'head', data[:16].hex())
    for name, fn in (('CBC', v_cbc), ('QQ', v_qq), ('QQ+CBC', v_qq_cbc)):
        full = fn(data, k)
        plain = strip(full, len(data))
        tag = ''
        if plain is not None:
            tag = 'proto=%s' % valid_proto(plain)
            print('%-7s pad=%d outlen=%d  head=%s  %s  txt=%r'
                  % (name, full[0] & 7, len(plain), plain[:24].hex(), tag,
                     plain[:48].decode('utf-8', 'replace')))
        else:
            print(name, 'outlen<0')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从火影OL 抓包流中导出组织成员名单 (cmd 199179) 为 JSON / CSV。

用法: python tools/extract_guild.py <sockets/1406-rx.bin> <输出前缀>

字段映射来自 serverProto.guild.ProtoGuildMemberInfo。
"""
import struct, sys, json, csv

DELTA = 0x9E3779B9
ROUNDS = 16
SALT_LEN = 2
ZERO_LEN = 7
M = 0xFFFFFFFF
KEY = b'd796c2542916b456'
HDR = 36

# field number -> 字段名 (ProtoGuildMemberInfo)
MEMBER_FIELDS = {
    2: 'playerNick', 3: 'playerLvl', 4: 'playerCombat', 5: 'playerCareer',
    6: 'identity', 7: 'loginFlag', 8: 'offlineTime', 9: 'currentContri',
    10: 'historyContri', 11: 'vipLevel', 13: 'inGvgWhiteList',
    14: 'inCallBackList', 15: 'mapAttackCareer', 16: 'talentCareerLvl',
    17: 'mapAttackTalentCombat', 18: 'mapAttackWeeklyScore',
}


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


def pb_fields(b):
    """返回 [(field_no, kind, value)]"""
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
            out.append((fn, 'len', b[i:i + ln]))
            i += ln
        elif wt == 5:
            out.append((fn, 'f32', struct.unpack('<I', b[i:i + 4])[0])); i += 4
        elif wt == 1:
            out.append((fn, 'f64', struct.unpack('<Q', b[i:i + 8])[0])); i += 8
        else:
            break
    return out


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
        out.append((struct.unpack('>I', d[off + 4:off + 8])[0], d[off + HDR:off + HDR + ln]))
        off += HDR + ln
    return out


def parse_members(plain):
    members = []
    for fn, kind, v in pb_fields(plain):
        if fn != 3 or kind != 'len':
            continue
        m = {}
        for mfn, mkind, mv in pb_fields(v):
            name = MEMBER_FIELDS.get(mfn)
            if mfn == 1 and mkind == 'len':
                # player_id = ProtoPlayerKey {uin, ...}
                pk = pb_fields(mv)
                m['uin'] = pk[0][2] if pk and pk[0][1] == 'int' else None
                if len(pk) > 2 and pk[2][1] == 'int':
                    m['serverId'] = pk[2][2]
            elif mkind == 'len':
                m[name or ('f%d' % mfn)] = mv.decode('utf-8', 'replace')
            elif mkind == 'int':
                m[name or ('f%d' % mfn)] = mv
        members.append(m)
    return members


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    src = sys.argv[1]
    prefix = sys.argv[2] if len(sys.argv) > 2 else 'guild'
    k = struct.unpack('>IIII', KEY)
    d = open(src, 'rb').read()

    all_members = {}
    for cmd, p in parse_frames(d):
        if cmd != 199179 or not p or len(p) % 8 or len(p) < 16:
            continue
        plain = strip(tea_decrypt(p, k), len(p))
        if not plain:
            continue
        for m in parse_members(plain):
            if m.get('uin'):
                all_members[m['uin']] = m  # 后到的覆盖先到的

    members = sorted(all_members.values(), key=lambda x: -x.get('playerCombat', 0))
    print('组织成员: %d 人' % len(members))
    for m in members:
        print('  %-16s Lv%-4s 战力%-9s 职业%s 职位%s 当前贡献%-6s 历史贡献%-7s 忍战本周%s'
              % (m.get('playerNick', '?'), m.get('playerLvl', '?'), m.get('playerCombat', '?'),
                 m.get('playerCareer', '?'), m.get('identity', '?'), m.get('currentContri', '?'),
                 m.get('historyContri', '?'), m.get('mapAttackWeeklyScore', '?')))

    with open(prefix + '.json', 'w', encoding='utf-8') as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    cols = ['uin', 'playerNick', 'playerLvl', 'playerCombat', 'playerCareer', 'identity',
            'loginFlag', 'currentContri', 'historyContri', 'mapAttackWeeklyScore']
    with open(prefix + '.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for m in members:
            w.writerow(m)
    print('\n已导出 %s.json / %s.csv' % (prefix, prefix))


if __name__ == '__main__':
    main()

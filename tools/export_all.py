#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从抓包流导出 5 类组织数据为 Excel (.xlsx，无第三方依赖)。

用法: python tools/export_all.py <sockets/1406-rx.bin> [输出目录]

5 类:
  1 组织成员   cmd 199179  ProtoGuildMemberInfo
  2 组织捐献   cmd 199184
  3 叛忍数据   cmd 852146(帮派排名) + 852147(成员排名)
  4 通灵兽     cmd 199264
  5 忍战       cmd 852296 (跨服忍战成员)
"""
import struct, sys, os, zipfile
from xml.sax.saxutils import escape

DELTA = 0x9E3779B9
ROUNDS = 16
SALT_LEN = 2
ZERO_LEN = 7
M = 0xFFFFFFFF
KEY = b'd796c2542916b456'
HDR = 36


# ---------------- TEA ----------------
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
    n = total - 1 - pad - SALT_LEN - ZERO_LEN
    if n < 0:
        return None
    return full[1 + pad + SALT_LEN:1 + pad + SALT_LEN + n]


# ---------------- protobuf ----------------
def rv(b, i):
    r = 0; s = 0
    while i < len(b):
        x = b[i]; i += 1
        r |= (x & 0x7f) << s
        if not (x & 0x80):
            return r, i
        s += 7
    raise ValueError


def pb(b):
    i = 0; out = []
    while i < len(b):
        key, i = rv(b, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = rv(b, i); out.append((fn, v))
        elif wt == 2:
            ln, i = rv(b, i); out.append((fn, b[i:i + ln])); i += ln
        elif wt == 5:
            out.append((fn, struct.unpack('<I', b[i:i + 4])[0])); i += 4
        elif wt == 1:
            out.append((fn, struct.unpack('<Q', b[i:i + 8])[0])); i += 8
        else:
            break
    return out


def g(fields, n):
    for fn, v in fields:
        if fn == n:
            return v
    return None


def ga(fields, n):
    return [v for fn, v in fields if fn == n]


def txt(b):
    return b.decode('utf-8', 'replace') if isinstance(b, bytes) else b


def uin_of(keybytes):
    f = pb(keybytes)
    return g(f, 1)


# ---------------- frames ----------------
def frames(d):
    out = []; off = 0
    while off + HDR <= len(d):
        if d[off] != 0x09 or d[off + 1] != 0x01:
            off += 1; continue
        ln = struct.unpack('>H', d[off + 2:off + 4])[0]
        if off + HDR + ln > len(d):
            break
        cmd = struct.unpack('>I', d[off + 4:off + 8])[0]
        out.append((cmd, d[off + HDR:off + HDR + ln]))
        off += HDR + ln
    return out


def decrypt(cmd, p, k):
    if not p:
        return None
    if len(p) % 8 or len(p) < 16:
        return None
    return strip(tea_decrypt(p, k), len(p))


# ---------------- xlsx (minimal, no deps) ----------------
def _col(n):
    s = ''
    while n >= 0:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
    return s


def _sheet(rows):
    o = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
         '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for ri, row in enumerate(rows, 1):
        o.append('<row r="%d">' % ri)
        for ci, v in enumerate(row):
            ref = _col(ci) + str(ri)
            if isinstance(v, (int, float)):
                o.append('<c r="%s"><v>%s</v></c>' % (ref, v))
            else:
                o.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                         % (ref, escape('' if v is None else str(v))))
        o.append('</row>')
    o.append('</sheetData></worksheet>')
    return ''.join(o)


def write_xlsx(path, sheets):
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="xml" ContentType="application/xml"/>',
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    for i in range(len(sheets)):
        ct.append('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1))
    ct.append('</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>']
    wbr = []
    for i, (name, _) in enumerate(sheets):
        wb.append('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i + 1, i + 1))
        wbr.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1))
    wb.append('</sheets></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships '
              'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(wbr) + '</Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ''.join(ct))
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', ''.join(wb))
        z.writestr('xl/_rels/workbook.xml.rels', wbrels)
        for i, (name, rows) in enumerate(sheets):
            z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), _sheet(rows))


# ---------------- 各数据集 ----------------
IDENTITY = {0: '成员', 1: '精英', 2: '暗部', 3: '高层', 4: '首领',
            5: '指挥官', 6: '军需官', 7: '科学家', 8: '通灵使'}
CAREER = {1: '碧蓝之牙', 2: '红莲之瞳', 3: '疾风舞者', 4: '黑夜之刃', 5: '赤色岩拳'}
# 奖励物品名 (来自用户确认)
ITEM_NAME = {11000001: '金币', 10800057: '洞穴钥匙'}


def player_key(m):
    """ProtoPlayerKey -> (uin, serverId)"""
    key = g(m, 1)
    if not key:
        return (None, None)
    kf = pb(key)
    return (g(kf, 1), g(kf, 3))


def fmt_dur(s):
    s = int(s or 0)
    if s <= 0:
        return '离线'
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, sec = divmod(s, 60)
    if d:
        return '%d天%d小时' % (d, h)
    if h:
        return '%d小时%d分' % (h, m)
    if m:
        return '%d分' % m
    return '%d秒' % sec


def ds_members(by_cmd):
    """组织成员 cmd 199179 —— 列: 成员/职务/组织贡献度/职业/等级/战斗力/离线时间/组织战白名单"""
    rows = [['成员', '职务', '组织贡献度', '职业', '等级', '战斗力', '离线时间', '组织战白名单']]
    seen = set()
    for p in by_cmd.get(199179, []):
        plain = decrypt(199179, p, K)
        if not plain:
            continue
        for fn, v in pb(plain):
            if fn != 3:
                continue
            m = pb(v)
            uin, sid = player_key(m)
            if uin is None or (sid, uin) in seen:
                continue
            seen.add((sid, uin))
            ident = g(m, 6) or 0
            career = g(m, 5) or 0
            login = g(m, 7)
            off = g(m, 8) or 0
            white = g(m, 13) or 0
            rows.append(['%s区-%s' % (sid, txt(g(m, 2))),
                         IDENTITY.get(ident, ident),
                         '%s/%s' % (g(m, 9), g(m, 10)),
                         CAREER.get(career, career),
                         g(m, 3), g(m, 4),
                         '在线' if login == 1 else fmt_dur(off),
                         '—' if not white else '是'])
    return rows


def ds_donate(by_cmd):
    """组织捐献 cmd 199184 (本周) —— 列: 排行/角色名字/捐献贡献 (保留服务器顺序)"""
    rows = [['排行', '角色名字', '捐献贡献']]
    seen = set()
    for p in by_cmd.get(199184, []):
        plain = decrypt(199184, p, K)
        if not plain:
            continue
        for fn, v in pb(plain):
            if fn != 4:
                continue
            e = pb(v)
            uin, sid = player_key(e)
            if uin is None or (sid, uin) in seen:
                continue
            seen.add((sid, uin))
            rows.append([len(seen), '%s区-%s' % (sid, txt(g(e, 2))), g(e, 3)])
    return rows


def ds_rebel(by_cmd):
    """叛忍成员排名 cmd 852147 —— 排名/玩家名/缉拿叛忍数/击杀数/杰出奖
    注: 数值以 600 为刻度 (实测 缉拿=raw/600, 击杀=raw/600)"""
    rows = [['排名', '玩家名', '缉拿叛忍数', '击杀数', '杰出奖']]
    seen = set()
    for p in by_cmd.get(852147, []):
        plain = decrypt(852147, p, K)
        if not plain:
            continue
        for fn, v in pb(plain):
            if fn != 2:
                continue
            e = pb(v)
            key = g(e, 2)
            kf = pb(key) if key else []
            uin, sid = g(kf, 1), g(kf, 3)
            if uin is None or (sid, uin) in seen:
                continue
            seen.add((sid, uin))
            rewards = []
            for x in ga(e, 5):
                it = pb(x)
                iid, cnt = g(it, 1), g(it, 2)
                rewards.append('%s%d' % (ITEM_NAME.get(iid, '道具%d' % iid), cnt or 0))
            kill = (g(e, 4) or 0) / 600
            kill = int(kill) if kill == int(kill) else round(kill, 2)
            rows.append([g(e, 1), '%s区-%s' % (sid, txt(g(e, 3))),
                         int((g(e, 6) or 0) / 600), kill,
                         '/'.join(rewards)])
    return rows


def ds_beast(by_cmd):
    """本周献祭 cmd 199209 —— 排行/角色名字/献祭通灵查克拉"""
    rows = [['排行', '角色名字', '献祭通灵查克拉']]
    seen = set()
    for p in by_cmd.get(199209, []):
        plain = decrypt(199209, p, K)
        if not plain:
            continue
        for fn, v in pb(plain):
            if fn != 6:
                continue
            e = pb(v)
            uin, sid = player_key(e)
            if uin is None or (sid, uin) in seen:
                continue
            seen.add((sid, uin))
            rows.append([len(seen), '%s区-%s' % (sid, txt(g(e, 2))), g(e, 3)])
    return rows


def ds_gvg(by_cmd):
    """忍战 cmd 852296(跨服) / 852233(本服)
    列: 名称/职务/参战次数/战斗力/战力增幅/本周贡献"""
    rows = [['名称', '职务', '参战次数', '战斗力', '战力增幅', '本周贡献']]
    seen = set()
    for cmd in (852296, 852233):
        for p in by_cmd.get(cmd, []):
            plain = decrypt(cmd, p, K)
            if not plain:
                continue
            for fn, v in pb(plain):
                if fn != 2:
                    continue
                e = pb(v)
                uin, sid = player_key(e)
                if uin is None or (sid, uin) in seen:
                    continue
                seen.add((sid, uin))
                ident = g(e, 3) or 0
                rows.append(['%s区-%s' % (sid, txt(g(e, 2))),
                             IDENTITY.get(ident, ident),
                             g(e, 4), g(e, 6), g(e, 7), g(e, 8)])
    return rows


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.makedirs(outdir, exist_ok=True)
    global K
    K = struct.unpack('>IIII', KEY)

    d = open(src, 'rb').read()
    by_cmd = {}
    for cmd, p in frames(d):
        by_cmd.setdefault(cmd, []).append(p)

    files = [
        ('1-组织成员.xlsx', [('组织成员', ds_members(by_cmd))]),
        ('2-组织捐献.xlsx', [('组织捐献', ds_donate(by_cmd))]),
        ('3-叛忍数据.xlsx', [('成员排名', ds_rebel(by_cmd))]),
        ('4-组织通灵兽.xlsx', [('本周献祭', ds_beast(by_cmd))]),
        ('5-忍战数据.xlsx', [('忍战成员', ds_gvg(by_cmd))]),
    ]

    for name, sheets in files:
        path = os.path.join(outdir, name)
        write_xlsx(path, sheets)
        cnt = ', '.join('%s:%d行' % (s[0], len(s[1]) - 1) for s in sheets)
        print('%-22s -> %s  (%s)' % (name, path, cnt))


if __name__ == '__main__':
    main()

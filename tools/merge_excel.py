#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把导出的 5 个 xlsx 按「成员名」合并成一张表（零依赖，手写 xlsx 读写）。

用法: python tools/merge_excel.py <目录或文件1> [文件2 ...] <输出.xlsx>

读取时兼容两种单元格写法：inlineStr（本工具生成）与 sharedStrings（Excel 另存）。
"""
import sys, os, re, zipfile, html

# 合并后的列顺序（各表按表头自动映射到这些列）
OUT_COLS = ['成员', '职务', '战斗力', '捐献贡献', '缉拿叛忍数', '献祭通灵查克拉', '参战次数']
# 这些列若为空则补 0（不留空值）
ZERO_COLS = {'战斗力', '捐献贡献', '缉拿叛忍数', '献祭通灵查克拉', '参战次数'}


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx(path):
    """返回 [[cell,...], ...]（仅第一个工作表，按单元格坐标对齐列）"""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        s = z.read('xl/sharedStrings.xml').decode('utf-8')
        shared = [html.unescape(re.sub('<[^>]+>', '', m)) for m in re.findall(r'<si>(.*?)</si>', s, re.S)]
    sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    xml = z.read(sheets[0]).decode('utf-8')
    rows = []
    for rm in re.findall(r'<row[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for cm in re.findall(r'<c\b[^>]*?(?:/>|>.*?</c>)', rm, re.S):
            ref = re.search(r'\br="([A-Z]+)\d+"', cm)
            ci = col_index(ref.group(1)) if ref else len(cells)
            t = re.search(r'\bt="([^"]+)"', cm)
            if t and t.group(1) == 'inlineStr':
                v = re.search(r'<t[^>]*>(.*?)</t>', cm, re.S)
                val = html.unescape(v.group(1)) if v else ''
            elif t and t.group(1) == 's':
                v = re.search(r'<v>(.*?)</v>', cm)
                val = shared[int(v.group(1))] if v else ''
            else:
                v = re.search(r'<v>(.*?)</v>', cm)
                if v:
                    s = v.group(1)
                    try:
                        f = float(s)
                        val = int(f) if f == int(f) else f
                    except ValueError:
                        val = s
                else:
                    val = ''
            cells[ci] = val
        if cells:
            n = max(cells) + 1
            rows.append([cells.get(i, '') for i in range(n)])
        else:
            rows.append([])
    return rows


def esc(s):
    return html.escape(str(s), quote=True)


def col_name(n):
    s = ''
    n += 1
    while n > 0:
        r = (n - 1) % 26
        s = chr(65 + r) + s
        n = (n - 1) // 26
    return s


def write_xlsx(path, rows):
    p = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
         '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for ri, row in enumerate(rows, 1):
        p.append('<row r="%d">' % ri)
        for ci, v in enumerate(row):
            ref = col_name(ci) + str(ri)
            if isinstance(v, (int, float)):
                p.append('<c r="%s"><v>%s</v></c>' % (ref, v))
            elif v not in (None, ''):
                p.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, esc(v)))
        p.append('</row>')
    p.append('</sheetData></worksheet>')
    sheet = ''.join(p)

    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types '
          'xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook '
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets><sheet name="合并" sheetId="1" r:id="rId1"/></sheets></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships '
              'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
              'Target="worksheets/sheet1.xml"/></Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wbrels)
        z.writestr('xl/worksheets/sheet1.xml', sheet)


def main():
    args = sys.argv[1:]
    out = args[-1]
    inputs = []
    for a in args[:-1]:
        if os.path.isdir(a):
            inputs += [os.path.join(a, f) for f in sorted(os.listdir(a)) if f.lower().endswith('.xlsx')]
        else:
            inputs.append(a)
    if not inputs:
        print('未找到输入 xlsx')
        sys.exit(1)

    merged = {}   # 名字 -> {列: 值}
    order = []
    for f in inputs:
        rows = read_xlsx(f)
        if not rows:
            continue
        header = [str(c) for c in rows[0]]
        # 找成员名列
        name_col = None
        for key in ('成员', '角色名字', '玩家名', '名称'):
            if key in header:
                name_col = key
                break
        if name_col is None:
            print('跳过（无成员名列）:', os.path.basename(f))
            continue
        ni = header.index(name_col)
        for r in rows[1:]:
            if ni >= len(r) or not r[ni]:
                continue
            name = str(r[ni])
            if name not in merged:
                merged[name] = {}
                order.append(name)
            for ci, col in enumerate(header):
                if col in OUT_COLS and col not in merged[name] and ci < len(r) and r[ci] != '':
                    merged[name][col] = r[ci]
            merged[name]['成员'] = name

    out_rows = [OUT_COLS]
    for name in order:
        row = []
        for c in OUT_COLS:
            v = merged[name].get(c, '')
            if (v == '' or v is None) and c in ZERO_COLS:
                v = 0
            row.append(v)
        out_rows.append(row)
    write_xlsx(out, out_rows)
    print('合并 %d 个文件 -> %d 行 -> %s' % (len(inputs), len(out_rows) - 1, out))


if __name__ == '__main__':
    main()

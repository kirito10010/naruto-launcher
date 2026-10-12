// xlsx.js —— 最小 .xlsx 生成器（零依赖，手写 ZIP + SpreadsheetML）
// 用法: writeXlsx(path, [{ name: '工作表名', rows: [[...], ...] }])
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  const p = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, ri) => {
    p.push('<row r="' + (ri + 1) + '">');
    row.forEach((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof v === 'number' && isFinite(v)) {
        p.push('<c r="' + ref + '"><v>' + v + '</v></c>');
      } else if (v !== null && v !== undefined && v !== '') {
        p.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>');
      }
    });
    p.push('</row>');
  });
  p.push('</sheetData></worksheet>');
  return p.join('');
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const comp = zlib.deflateRawSync(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    parts.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

function writeXlsx(filePath, sheets) {
  const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'];
  sheets.forEach((s, i) => ct.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) +
    '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'));
  ct.push('</Types>');

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' +
    'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" ' +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
    'Target="xl/workbook.xml"/></Relationships>';

  const wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'];
  const wbr = [];
  sheets.forEach((s, i) => {
    wb.push('<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
    wbr.push('<Relationship Id="rId' + (i + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      'Target="worksheets/sheet' + (i + 1) + '.xml"/>');
  });
  wb.push('</sheets></workbook>');
  const wbrels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ' +
    'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbr.join('') + '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(ct.join(''), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(wb.join(''), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbrels, 'utf8') },
  ];
  sheets.forEach((s, i) => files.push({
    name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
    data: Buffer.from(sheetXml(s.rows), 'utf8')
  }));

  fs.writeFileSync(filePath, zip(files));
}

module.exports = { writeXlsx };

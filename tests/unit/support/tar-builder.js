/**
 * Builds tar archives byte by byte for tests (ustar headers, pax records, links, any type), so
 * the unpacker can be shown unsafe archives exactly as an attacker could write them.
 */

function header({ name, type = '0', size = 0, mode = 0o644, linkname = '', prefix = '' }) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  h.write('00000000000\0', 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write(linkname, 157, 100, 'utf8');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) {sum += b;}
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

function pad(data) {
  const extra = data.length % 512;
  return extra ? Buffer.concat([data, Buffer.alloc(512 - extra)]) : data;
}

/** entries: { name, data?, type?, mode?, linkname?, pax? } */
function tar(entries, { end = true } = {}) {
  const parts = [];
  for (const e of entries) {
    if (e.pax) {
      const body = Buffer.from(Object.entries(e.pax).map(([k, v]) => {
        const rec = ` ${k}=${v}\n`;
        let len = rec.length + 1;
        while (String(len).length + rec.length !== len) {len = String(len).length + rec.length;}
        return `${len}${rec}`;
      }).join(''));
      parts.push(header({ name: 'PaxHeader', type: 'x', size: body.length }), pad(body));
    }
    const data = Buffer.from(e.data || '');
    parts.push(header({ name: e.name, type: e.type || '0', size: e.type && e.type !== '0' ? 0 : data.length, mode: e.mode, linkname: e.linkname }));
    if (data.length && (!e.type || e.type === '0')) {parts.push(pad(data));}
  }
  if (end) {parts.push(Buffer.alloc(1024));}
  return Buffer.concat(parts);
}

module.exports = { tar, header };

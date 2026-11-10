/** A small real .xlsx writer, so every till doesn't have to download a large spreadsheet library. */
type Cell = string | number;
export type Sheet = { name: string; rows: Cell[][] };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function column(i: number) {
  let name = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(rows: Cell[][]) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${column(c)}${r + 1}`;
          return typeof cell === "number" ? `<c r="${ref}"><v>${cell}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function zip(files: { name: string; text: string }[]) {
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const u16 = (v: DataView, at: number, n: number) => v.setUint16(at, n, true);
  const u32 = (v: DataView, at: number, n: number) => v.setUint32(at, n, true);
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    u32(local, 0, 0x04034b50); u16(local, 4, 20); u16(local, 6, 0x0800);
    u32(local, 14, crc); u32(local, 18, data.length); u32(local, 22, data.length); u16(local, 26, name.length);
    parts.push(local.buffer as ArrayBuffer, name as BlobPart, data as BlobPart);
    const head = new DataView(new ArrayBuffer(46));
    u32(head, 0, 0x02014b50); u16(head, 4, 20); u16(head, 6, 20); u16(head, 8, 0x0800);
    u32(head, 16, crc); u32(head, 20, data.length); u32(head, 24, data.length); u16(head, 28, name.length); u32(head, 42, offset);
    central.push(head.buffer as ArrayBuffer, name as BlobPart);
    offset += 30 + name.length + data.length;
  }
  const size = files.reduce((n, f) => n + 46 + encoder.encode(f.name).length, 0);
  const end = new DataView(new ArrayBuffer(22));
  u32(end, 0, 0x06054b50); u16(end, 8, files.length); u16(end, 10, files.length); u32(end, 12, size); u32(end, 16, offset);
  return new Blob([...parts, ...central, end.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function workbook(sheets: Sheet[]) {
  const names = sheets.map((s, i) => `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip([
    { name: "[Content_Types].xml", text: `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", text: `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `${header}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
  ]);
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Reads the first sheet of an .xlsx file using the browser's own decompression. */
export async function readFirstSheet(file: Blob): Promise<string[][]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buffer.buffer);
  let end = buffer.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a workbook");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<string>>();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(buffer.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, async () => {
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      const raw = buffer.slice(start, start + size);
      if (method === 0) return decoder.decode(raw);
      return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    });
    at += 46 + nameLength + extra + comment;
  }
  const parse = (text: string) => new DOMParser().parseFromString(text, "application/xml");
  const sharedFile = entries.get("xl/sharedStrings.xml");
  const shared = sharedFile ? [...parse(await sharedFile()).getElementsByTagName("si")].map((si) => si.textContent ?? "") : [];
  const sheetFile = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetFile) throw new Error("no sheet");
  const columnIndex = (ref: string) => [...ref.replace(/\d/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...parse(await sheetFile()).getElementsByTagName("row")].map((row) => {
    const cells: string[] = [];
    for (const cell of row.getElementsByTagName("c")) {
      const type = cell.getAttribute("t");
      const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[columnIndex(cell.getAttribute("r") ?? "A")] = type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? (cell.textContent ?? "") : value;
    }
    return Array.from(cells, (c) => c ?? "");
  });
}

export function readCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rows[rows.length - 1].push(cell); cell = ""; }
    else if (ch === "\n") { rows[rows.length - 1].push(cell.replace(/\r$/, "")); cell = ""; rows.push([]); }
    else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Direct printing to ESC/POS thermal receipt printers over Web Serial or WebUSB (Chrome and Edge).
// Most cheap printers have no Bangla font, so every receipt is drawn on a canvas in the app's own
// font and sent as a picture. The same connection kicks the cash drawer plugged into the printer.

export type Line =
  | { kind: "text"; text: string; align?: "left" | "center"; bold?: boolean; size?: "normal" | "large" | "small" }
  | { kind: "pair"; left: string; right: string; bold?: boolean; size?: "normal" | "large" }
  | { kind: "rule" }
  | { kind: "gap" };

type Writer = { write: (data: Uint8Array) => Promise<void>; label: string };

// Typed loosely: the Web Serial and WebUSB types aren't in TypeScript's standard DOM library.
type SerialPortLike = { open(o: { baudRate: number }): Promise<void>; writable: WritableStream<Uint8Array> | null; getInfo?: () => unknown };
type UsbDeviceLike = {
  opened: boolean; productName?: string; configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: { direction: string; type: string; endpointNumber: number }[] } }[] } | null;
  open(): Promise<void>; selectConfiguration(n: number): Promise<void>; claimInterface(n: number): Promise<void>; transferOut(ep: number, data: BufferSource): Promise<unknown>;
};
const nav = navigator as Navigator & {
  serial?: { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> };
  usb?: { requestDevice(o: { filters: object[] }): Promise<UsbDeviceLike>; getDevices(): Promise<UsbDeviceLike[]> };
};

let writer: Writer | null = null;

export const directPrintSupported = () => Boolean(nav.serial || nav.usb);
export const printerReady = () => writer !== null;

async function fromSerial(port: SerialPortLike): Promise<Writer> {
  if (!port.writable) await port.open({ baudRate: 9600 });
  return {
    label: "Serial printer",
    write: async (data) => {
      const w = port.writable!.getWriter();
      try {
        await w.write(data);
      } finally {
        w.releaseLock();
      }
    },
  };
}

async function fromUsb(device: UsbDeviceLike): Promise<Writer> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  for (const iface of device.configuration?.interfaces ?? []) {
    const out = iface.alternate.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (!out) continue;
    await device.claimInterface(iface.interfaceNumber).catch(() => undefined); // Already claimed by this page.
    return {
      label: device.productName || "USB printer",
      write: async (data) => {
        // Small pieces: some printers drop data sent in one large transfer.
        for (let i = 0; i < data.length; i += 4096) await device.transferOut(out.endpointNumber, data.slice(i, i + 4096));
      },
    };
  }
  throw new Error("This USB device has no printer connection.");
}

/** Asks the person to pick a printer. Must run from a tap or click. */
export async function connectPrinter(kind: "usb" | "serial") {
  if (kind === "usb" && nav.usb) writer = await fromUsb(await nav.usb.requestDevice({ filters: [{ classCode: 7 }, {}] }));
  else if (nav.serial) writer = await fromSerial(await nav.serial.requestPort());
  else throw new Error("unsupported");
  return writer.label;
}

/** Reconnects quietly to a printer this browser was already allowed to use. */
export async function reconnectPrinter() {
  if (writer) return true;
  try {
    const usb = (await nav.usb?.getDevices()) ?? [];
    if (usb[0]) writer = await fromUsb(usb[0]);
    else {
      const ports = (await nav.serial?.getPorts()) ?? [];
      if (ports[0]) writer = await fromSerial(ports[0]);
    }
  } catch {
    writer = null;
  }
  return writer !== null;
}

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const CUT = [GS, 0x56, 0x42, 0x00];
/** Pulse pin 2 for 50 ms on, 500 ms off: the standard cash drawer kick. */
const DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa];

const FONT = '"Hind Siliguri", "Lalcha Digits", "Archivo", sans-serif';

/** Draws the lines on a canvas the printer's width and turns it into black-and-white raster rows. */
function render(lines: Line[], paper: 58 | 80) {
  const width = paper === 58 ? 384 : 576;
  const pad = 8;
  const px = { small: 20, normal: 24, large: 34 };
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const wrap = (text: string, size: number, bold: boolean, max: number) => {
    ctx.font = `${bold ? 700 : 500} ${size}px ${FONT}`;
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let current = "";
      for (const word of para.split(" ")) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width > max && current) {
          out.push(current);
          current = word;
        } else current = next;
      }
      out.push(current);
    }
    return out;
  };
  // First pass measures the height, the second draws.
  const draw = (paint: boolean) => {
    let y = pad;
    for (const l of lines) {
      if (l.kind === "gap") y += 12;
      else if (l.kind === "rule") {
        if (paint) {
          ctx.fillRect(pad, y + 6, width - pad * 2, 2);
        }
        y += 16;
      } else if (l.kind === "text") {
        const size = px[l.size ?? "normal"];
        for (const row of wrap(l.text, size, Boolean(l.bold), width - pad * 2)) {
          if (paint) {
            ctx.font = `${l.bold ? 700 : 500} ${size}px ${FONT}`;
            ctx.textAlign = l.align === "center" ? "center" : "left";
            ctx.fillText(row, l.align === "center" ? width / 2 : pad, y + size);
          }
          y += size + 8;
        }
      } else {
        const size = px[l.size ?? "normal"];
        ctx.font = `${l.bold ? 700 : 500} ${size}px ${FONT}`;
        const rightWidth = ctx.measureText(l.right).width;
        const rows = wrap(l.left, size, Boolean(l.bold), width - pad * 3 - rightWidth);
        rows.forEach((row, i) => {
          if (paint) {
            ctx.font = `${l.bold ? 700 : 500} ${size}px ${FONT}`;
            ctx.textAlign = "left";
            ctx.fillText(row, pad, y + size);
            if (i === 0) {
              ctx.textAlign = "right";
              ctx.fillText(l.right, width - pad, y + size);
            }
          }
          y += size + 8;
        });
      }
    }
    return y + pad;
  };
  canvas.width = width;
  canvas.height = Math.ceil(draw(false));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = "#000";
  draw(true);

  const { data } = ctx.getImageData(0, 0, width, canvas.height);
  const bytesPerRow = width / 8;
  const raster = new Uint8Array(bytesPerRow * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 160) raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { raster, bytesPerRow, height: canvas.height };
}

/** GS v 0 in bands of 128 rows: some printers run out of buffer on one tall image. */
function rasterCommands(r: { raster: Uint8Array; bytesPerRow: number; height: number }) {
  const parts: number[][] = [];
  for (let top = 0; top < r.height; top += 128) {
    const rows = Math.min(128, r.height - top);
    parts.push([GS, 0x76, 0x30, 0x00, r.bytesPerRow & 0xff, r.bytesPerRow >> 8, rows & 0xff, rows >> 8]);
    parts.push(Array.from(r.raster.subarray(top * r.bytesPerRow, (top + rows) * r.bytesPerRow)));
  }
  return parts.flat();
}

export async function printDirect(lines: Line[], paper: 58 | 80, opts: { openDrawer?: boolean } = {}) {
  if (!writer && !(await reconnectPrinter())) throw new Error("no_printer");
  await document.fonts.ready;
  const bytes = [...INIT, ...rasterCommands(render(lines, paper)), 0x0a, 0x0a, 0x0a, ...CUT, ...(opts.openDrawer ? DRAWER : [])];
  try {
    await writer!.write(new Uint8Array(bytes));
  } catch (e) {
    writer = null; // Unplugged: the next print reconnects.
    throw e;
  }
}

export async function openDrawer() {
  if (!writer && !(await reconnectPrinter())) throw new Error("no_printer");
  await writer!.write(new Uint8Array([...INIT, ...DRAWER]));
}

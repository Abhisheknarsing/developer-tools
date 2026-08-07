const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Data
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = writeChunk('IHDR', ihdr);

  // Raw RGBA pixels with filter byte 0 at start of each scanline
  const scanlineSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineSize;
    rawData[rowOffset] = 0; // None filter

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Draw Jira Icon: Modern Blue Gradient with Jira White Mark
      const nx = x / width;
      const ny = y / height;
      const margin = 0.1;

      if (nx >= margin && nx <= 1 - margin && ny >= margin && ny <= 1 - margin) {
        // Soft rounded rectangle background
        const bgR = Math.floor(0x25 + nx * 0x10);
        const bgG = Math.floor(0x6b + ny * 0x20);
        const bgB = 0xe6;

        // Jira Logo symbol simplified (two overlapping shapes)
        const isJiraBlue = ny > 0.25 && ny < 0.75 && nx > 0.25 && nx < 0.75;
        const isWhiteCore = (nx >= 0.35 && nx <= 0.65 && ny >= 0.35 && ny <= 0.5) ||
                           (nx >= 0.45 && nx <= 0.65 && ny >= 0.5 && ny <= 0.65);

        if (isWhiteCore) {
          rawData[pxOffset] = 0xff;     // R
          rawData[pxOffset + 1] = 0xff; // G
          rawData[pxOffset + 2] = 0xff; // B
          rawData[pxOffset + 3] = 0xff; // A
        } else {
          rawData[pxOffset] = bgR;
          rawData[pxOffset + 1] = bgG;
          rawData[pxOffset + 2] = bgB;
          rawData[pxOffset + 3] = 0xff;
        }
      } else {
        // Transparent outer edges
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = writeChunk('IDAT', compressedData);
  const iendChunk = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), pngBuf);
  console.log(`Generated icon-${size}.png`);
});

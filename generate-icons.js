// Simple icon generator using Node.js built-in modules
// Generates PNG with transparency (RGBA)
const fs = require('fs');
const zlib = require('zlib');

function createPNG(size, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr.writeUInt8(8, 8);        // bit depth
  ihdr.writeUInt8(6, 9);        // color type 6 = RGBA (with alpha)
  ihdr.writeUInt8(0, 10);       // compression
  ihdr.writeUInt8(0, 11);       // filter
  ihdr.writeUInt8(0, 12);       // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk (image data) - now 4 bytes per pixel (RGBA)
  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rawData[rowStart] = 0; // filter byte

    for (let x = 0; x < size; x++) {
      const pixelStart = rowStart + 1 + x * 4;
      // Create a simple circular icon
      const centerDist = Math.sqrt(Math.pow(x - size/2 + 0.5, 2) + Math.pow(y - size/2 + 0.5, 2));
      const maxDist = size / 2;

      if (centerDist < maxDist * 0.75) {
        // Inner circle - main color, fully opaque
        rawData[pixelStart] = r;
        rawData[pixelStart + 1] = g;
        rawData[pixelStart + 2] = b;
        rawData[pixelStart + 3] = 255; // alpha = opaque
      } else if (centerDist < maxDist * 0.9) {
        // Darker border ring
        rawData[pixelStart] = Math.floor(r * 0.7);
        rawData[pixelStart + 1] = Math.floor(g * 0.7);
        rawData[pixelStart + 2] = Math.floor(b * 0.7);
        rawData[pixelStart + 3] = 255; // alpha = opaque
      } else if (centerDist < maxDist) {
        // Anti-aliased edge - semi-transparent
        const edgeFade = 1 - (centerDist - maxDist * 0.9) / (maxDist * 0.1);
        rawData[pixelStart] = Math.floor(r * 0.7);
        rawData[pixelStart + 1] = Math.floor(g * 0.7);
        rawData[pixelStart + 2] = Math.floor(b * 0.7);
        rawData[pixelStart + 3] = Math.floor(255 * edgeFade); // fading alpha
      } else {
        // Outside circle - fully transparent
        rawData[pixelStart] = 0;
        rawData[pixelStart + 1] = 0;
        rawData[pixelStart + 2] = 0;
        rawData[pixelStart + 3] = 0; // alpha = transparent
      }
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  const table = makeCRCTable();

  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }

  return crc ^ 0xffffffff;
}

function makeCRCTable() {
  const table = new Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

// Generate icons with Patreon-like orange color
const sizes = [16, 48, 128];
const color = { r: 255, g: 85, b: 0 }; // #ff5500

sizes.forEach(size => {
  const png = createPNG(size, color.r, color.g, color.b);
  fs.writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Created icon${size}.png (${size}x${size}) with transparent background`);
});

console.log('All icons generated with transparency!');

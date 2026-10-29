'use strict';
const sharp = require('sharp');

const MAX_DIM = Number(process.env.MAX_IMAGE_DIM || 2048);

/** Decode any sharp-supported image into 8-bit grayscale (BT.709 luma), capped at MAX_DIM. */
async function decodeToGray(buffer) {
  const { data, info } = await sharp(buffer, { failOn: 'error' })
    .rotate() // honour EXIF orientation
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000000' })
    .greyscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  let gray;
  if (info.channels > 1) {
    gray = new Uint8Array(info.width * info.height);
    for (let i = 0; i < gray.length; i++) gray[i] = data[i * info.channels];
  } else {
    gray = Uint8Array.from(data); // detach from sharp's buffer pool
  }
  return { pixels: gray, width: info.width, height: info.height };
}

function encodePng(pixels, width, height, compressionLevel = 1) {
  return sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length), {
    raw: { width, height, channels: 1 },
  }).toColourspace('b-w').png({ compressionLevel }).toBuffer();
}

module.exports = { decodeToGray, encodePng, MAX_DIM };

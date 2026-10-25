// Browser-only preparation. Original health photos never enter persistent storage.
const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;
const MAX_HEADER_BYTES = 1024 * 1024;
const PREPARE_TIMEOUT_MS = 15_000;
const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const readBlob = (blob, method) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  let settled = false;
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reader.onload = reader.onerror = reader.onabort = null;
    if (error) reject(error); else resolve(result);
  };
  const failure = () => new Error('사진을 읽지 못했어요. 다시 촬영하거나 다른 사진을 골라 주세요.');
  const timer = setTimeout(() => { finish(failure()); reader.abort(); }, PREPARE_TIMEOUT_MS);
  reader.onload = () => finish(null, reader.result);
  reader.onerror = reader.onabort = () => finish(failure());
  try { reader[method](blob); } catch { finish(failure()); }
});
const readDataUrl = blob => readBlob(blob, 'readAsDataURL');
const invalidDimensions = () => new Error('사진을 열지 못했어요. 사진 크기 정보를 확인할 수 없거나 해상도가 너무 커요. 다시 촬영하거나 다른 사진을 골라 주세요.');
function checkDimensions(width, height) {
  if (!width || !height || width * height > MAX_PIXELS) throw invalidDimensions();
}
function verifyHeaderDimensions(header, type, fileSize) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const ascii = (start, count) => String.fromCharCode(...header.slice(start, start + count));
  if (type === 'image/png') {
    if (header.length < 33 || view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') throw invalidDimensions();
    checkDimensions(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (type === 'image/jpeg') {
    let offset = 2, dimensions = null;
    const frames = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset < header.length) {
      if (header[offset++] !== 0xff) throw invalidDimensions();
      while (offset < header.length && header[offset] === 0xff) offset++;
      if (offset >= header.length) break;
      const marker = header[offset++];
      if (marker === 0xda || marker === 0xd9) {
        if (!dimensions) throw invalidDimensions();
        return;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0 || marker === 0xd8 || offset + 2 > header.length) throw invalidDimensions();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > header.length || offset + length > fileSize) throw invalidDimensions();
      if (frames.has(marker)) {
        if (length < 8) throw invalidDimensions();
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
        checkDimensions(width, height);
        if (dimensions && (dimensions.width !== width || dimensions.height !== height)) throw invalidDimensions();
        dimensions = { width, height };
      }
      offset += length;
    }
    throw invalidDimensions();
  }
  if (type === 'image/webp') {
    if (header.length < 20 || view.getUint32(4, true) + 8 > fileSize) throw invalidDimensions();
    const containerEnd = view.getUint32(4, true) + 8;
    const uint24 = offset => header[offset] + header[offset + 1] * 256 + header[offset + 2] * 65536;
    let offset = 12, canvas = null;
    while (offset + 8 <= header.length && offset + 8 <= containerEnd) {
      const chunk = ascii(offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8;
      if (data + length > containerEnd || data + length > fileSize) throw invalidDimensions();
      if (chunk === 'VP8X') {
        if (length !== 10 || data + 10 > header.length) throw invalidDimensions();
        canvas = { width: uint24(data + 4) + 1, height: uint24(data + 7) + 1 };
        checkDimensions(canvas.width, canvas.height);
      } else if (chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'ANMF') {
        let width, height;
        if (chunk === 'VP8 ') {
          if (length < 10 || data + 10 > header.length || header[data] & 1 || ascii(data + 3, 3) !== '\x9d\x01\x2a') throw invalidDimensions();
          width = view.getUint16(data + 6, true) & 0x3fff;
          height = view.getUint16(data + 8, true) & 0x3fff;
        } else if (chunk === 'VP8L') {
          if (length < 5 || data + 5 > header.length || header[data] !== 0x2f || header[data + 4] >> 5) throw invalidDimensions();
          const packed = view.getUint32(data + 1, true);
          width = (packed & 0x3fff) + 1;
          height = ((packed >>> 14) & 0x3fff) + 1;
        } else {
          if (!canvas || length < 16 || data + 16 > header.length) throw invalidDimensions();
          width = uint24(data + 6) + 1;
          height = uint24(data + 9) + 1;
        }
        checkDimensions(width, height);
        if (canvas && (width > canvas.width || height > canvas.height)) throw invalidDimensions();
        return;
      }
      offset = data + length + (length & 1);
    }
    throw invalidDimensions();
  }
}
async function verifyImageType(file, heic) {
  const header = new Uint8Array(await readBlob(file.slice(0, MAX_HEADER_BYTES), 'readAsArrayBuffer'));
  const ascii = (start, count) => String.fromCharCode(...header.slice(start, start + count));
  const type = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff ? 'image/jpeg'
    : header.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => header[index] === value) ? 'image/png'
    : ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' ? 'image/webp' : null;
  if (SUPPORTED.has(file.type) && type === file.type) { verifyHeaderDimensions(header, type, file.size); return; }
  if (!SUPPORTED.has(file.type) && heic && ascii(4, 4) === 'ftyp' && /hei[cfxm]|hevc|hevx|mif1|msf1/.test(ascii(8, 248))) return;
  throw new Error('사진 형식을 확인하지 못했어요. 다시 촬영하거나 JPG·PNG·WebP 사진을 골라 주세요.');
}
// HTMLImageElement uses the browser's EXIF orientation and works on Safari without createImageBitmap.
function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;
    const release = () => { image.onload = image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url); };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release();
      reject(new Error('decode'));
    };
    const timer = setTimeout(fail, PREPARE_TIMEOUT_MS);
    image.onload = () => {
      if (settled) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_PIXELS) { fail(); return; }
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight, close: release });
    };
    image.onerror = fail;
    image.src = url;
  });
}
const canvasBlob = (canvas, quality) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('encode-timeout')), PREPARE_TIMEOUT_MS);
  try { canvas.toBlob(blob => { clearTimeout(timer); resolve(blob); }, 'image/jpeg', quality); }
  catch (error) { clearTimeout(timer); reject(error); }
});
export async function preparePatientImage(file) {
  if (!file || file.size === 0) throw new Error('비어 있는 사진이에요. 다른 사진을 골라 주세요.');
  if (file.size > 20 * 1024 * 1024) throw new Error('사진이 너무 커요. 카메라로 다시 찍거나 20MB 이하 사진을 골라 주세요.');
  const heic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
  if (!SUPPORTED.has(file.type) && !heic) throw new Error('JPG·PNG·WebP 사진을 골라 주세요. 다른 형식은 카메라로 다시 찍어 주세요.');
  await verifyImageType(file, heic);
  let decoded;
  try {
    // Every file must decode, including small files which previously skipped validation.
    decoded = await decodeImage(file);
    // Preserve validated supported small images byte-for-byte: analyses bind to these bytes.
    if (SUPPORTED.has(file.type) && file.size <= MAX_UPLOAD) return { imageData: await readDataUrl(file), adjusted: false };
    const scale = Math.min(1, 2048 / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.74, 0.6]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob && blob.size <= MAX_UPLOAD) return { imageData: await readDataUrl(blob), adjusted: true };
    }
    throw new Error('size');
  } catch {
    throw new Error(heic ? '이 브라우저에서는 HEIC 사진을 열 수 없어요. 아래 카메라 버튼으로 다시 찍거나 JPG 사진을 골라 주세요.' : '사진을 열지 못했어요. 다시 촬영하거나 다른 JPG·PNG·WebP 사진을 골라 주세요.');
  } finally { decoded?.close(); }
}

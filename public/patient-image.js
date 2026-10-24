// Browser-only preparation. Original health photos never enter persistent storage.
const MAX_UPLOAD = 5 * 1024 * 1024;
const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const readDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('사진을 읽지 못했어요. 다시 촬영하거나 다른 사진을 골라 주세요.'));
  reader.readAsDataURL(blob);
});
export async function preparePatientImage(file) {
  if (!file || file.size === 0) throw new Error('비어 있는 사진이에요. 다른 사진을 골라 주세요.');
  if (file.size > 20 * 1024 * 1024) throw new Error('사진이 너무 커요. 카메라로 다시 찍거나 20MB 이하 사진을 골라 주세요.');
  const heic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
  if (!SUPPORTED.has(file.type) && !heic) throw new Error('JPG·PNG·WebP 사진을 골라 주세요. 다른 형식은 카메라로 다시 찍어 주세요.');
  // Keep already supported small images byte-for-byte: analyses bind to these bytes.
  if (SUPPORTED.has(file.type) && file.size <= MAX_UPLOAD) return { imageData: await readDataUrl(file), adjusted: false };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) throw new Error('dimensions');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.74, 0.6]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_UPLOAD) return { imageData: await readDataUrl(blob), adjusted: true };
    }
    throw new Error('size');
  } catch {
    throw new Error(heic ? '이 브라우저에서는 HEIC 사진을 열 수 없어요. 아래 카메라 버튼으로 다시 찍거나 JPG 사진을 골라 주세요.' : '사진 크기를 줄이지 못했어요. 카메라로 다시 찍거나 더 작은 사진을 골라 주세요.');
  } finally { bitmap?.close(); }
}

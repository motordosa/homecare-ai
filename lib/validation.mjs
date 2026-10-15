export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON 객체를 입력해 주세요.');
  return value;
}

export function allowedKeys(body, keys) {
  const unknown = Object.keys(body).filter(key => !keys.includes(key));
  if (unknown.length) throw new HttpError(400, `지원하지 않는 입력 항목: ${unknown.join(', ')}`);
}

export function textValue(value, name, { min = 0, max = 2000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /\u0000/.test(value)) throw new HttpError(400, `${name} 입력을 확인해 주세요. (${min}~${max}자)`);
  return value.trim();
}

export function numberValue(value, name, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new HttpError(400, `${name}: ${min}~${max} 범위의 ${integer ? '정수' : '숫자'}를 입력해 주세요.`);
  return value;
}

export function choice(value, name, options) {
  if (!options.includes(value)) throw new HttpError(400, `${name} 입력값을 확인해 주세요.`);
  return value;
}

export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, '날짜 형식은 YYYY-MM-DD입니다.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '2200-01-01') throw new HttpError(400, '유효한 날짜를 입력해 주세요.');
  return value;
}

export function textList(value, name) {
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, `${name}: 최대 20개 항목을 입력해 주세요.`);
  return value.map(item => textValue(item, name, { min: 1, max: 100 }));
}

export function decodeImage(value) {
  if (typeof value !== 'string') throw new HttpError(400, '사진은 지원되는 이미지의 data URL이어야 합니다.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw new HttpError(400, 'JPEG, PNG, WebP 사진만 첨부할 수 있습니다.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw new HttpError(413, '사진 크기는 5MB 이하여야 합니다.');
  if (buffer.length < 12) throw new HttpError(400, '사진 파일이 올바르지 않습니다.');
  const type = match[1];
  const signatureValid = type === 'jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff : type === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!signatureValid) throw new HttpError(400, '사진의 형식과 파일 내용이 일치하지 않습니다.');
  return { buffer, extension: type === 'jpeg' ? 'jpg' : type };
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Spreadsheet programs interpret leading =,+,-,@ and control characters as formulas.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

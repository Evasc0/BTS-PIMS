export const splitFullName = (fullName: string): { firstName: string; lastName: string } => {
  const normalized = String(fullName || '').trim();
  if (!normalized) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = normalized.split(/\s+/u);
  return {
    firstName: firstName || '',
    lastName: rest.join(' ')
  };
};

export const buildFullName = (firstName: string, lastName: string): string =>
  [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ').trim();

export const getInitials = (fullName: string): string =>
  String(fullName || '')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

const loadImageElement = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image data.'));
    image.src = source;
  });

const estimateDataUrlBytes = (dataUrl: string): number => {
  const value = String(dataUrl || '');
  const base64 = value.includes(',') ? value.split(',', 2)[1] : value;
  return Math.ceil((base64.length * 3) / 4);
};

const normalizeImageMimeType = (fileType: string): 'image/jpeg' | 'image/png' => {
  const normalized = String(fileType || '').toLowerCase();
  if (normalized === 'image/png') return 'image/png';
  return 'image/jpeg';
};

export async function optimizeProfileImage(file: File): Promise<{ dataUrl: string; format: string; sizeBytes: number }> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxDimension = 512;
  const sourceWidth = image.naturalWidth || image.width || maxDimension;
  const sourceHeight = image.naturalHeight || image.height || maxDimension;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to process image on this device.');
  ctx.drawImage(image, 0, 0, width, height);

  const targetMime = normalizeImageMimeType(file.type);
  let finalDataUrl = '';

  if (targetMime === 'image/jpeg') {
    const qualities = [0.86, 0.78, 0.7, 0.62];
    for (const quality of qualities) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      finalDataUrl = candidate;
      if (estimateDataUrlBytes(candidate) <= 350 * 1024) break;
    }
  } else {
    finalDataUrl = canvas.toDataURL('image/png');
  }

  if (!finalDataUrl) {
    finalDataUrl = canvas.toDataURL('image/jpeg', 0.78);
  }

  const format = finalDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return {
    dataUrl: finalDataUrl,
    format,
    sizeBytes: estimateDataUrlBytes(finalDataUrl)
  };
}

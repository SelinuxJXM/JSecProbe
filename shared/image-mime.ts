/**
 * 从图片 base64 的真实文件头推断 MIME（纯函数，便于单测）。
 *
 * 背景：encodeImageToBase64 对小图直接返回原始格式（PNG/GIF/WebP 等），
 * desensitizeImage 在无敏感内容时也返回原图；此前一律拼 `data:image/jpeg;base64,`，
 * MIME 与实际内容不符，严格的视觉模型服务端会拒绝或解析错误。
 */
export function imageMimeFromBase64(base64: string): string {
  try {
    const bin = atob(String(base64 || '').slice(0, 64));
    const b = (i: number) => bin.charCodeAt(i);
    // PNG: 89 50 4E 47
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
    // JPEG: FF D8 FF
    if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
    // GIF: GIF8
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'image/gif';
    // BMP: BM
    if (b(0) === 0x42 && b(1) === 0x4d) return 'image/bmp';
    // WebP: RIFF....WEBP
    if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
        && bin.slice(8, 12) === 'WEBP') return 'image/webp';
    // TIFF: II*\0（小端）/ MM\0*（大端）——与 isImageFile 的 tiff 扩展名口径保持一致
    if ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00)
        || (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a)) return 'image/tiff';
  } catch { /* 非法 base64 走默认 */ }
  return 'image/jpeg';
}

import { describe, it, expect } from 'vitest';
import { imageMimeFromBase64 } from '../../shared/image-mime';

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

describe('imageMimeFromBase64 按真实文件头推断 MIME', () => {
  it('PNG', () => {
    expect(imageMimeFromBase64(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
  });
  it('JPEG', () => {
    expect(imageMimeFromBase64(b64([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('GIF', () => {
    expect(imageMimeFromBase64(Buffer.from('GIF89a').toString('base64'))).toBe('image/gif');
  });
  it('BMP', () => {
    expect(imageMimeFromBase64(b64([0x42, 0x4d, 0x00, 0x00]))).toBe('image/bmp');
  });
  it('WebP 需 RIFF + WEBP 双标识', () => {
    const webp = [...Buffer.from('RIFF')].concat([0, 0, 0, 0], [...Buffer.from('WEBP')]);
    expect(imageMimeFromBase64(b64(webp))).toBe('image/webp');
    const wav = [...Buffer.from('RIFF')].concat([0, 0, 0, 0], [...Buffer.from('WAVE')]);
    expect(imageMimeFromBase64(b64(wav))).toBe('image/jpeg'); // 非 WebP 走默认
  });
  it('TIFF 小端(II*)与大端(MM*)', () => {
    expect(imageMimeFromBase64(b64([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]))).toBe('image/tiff');
    expect(imageMimeFromBase64(b64([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08]))).toBe('image/tiff');
  });
  it('非法/空输入返回默认 jpeg', () => {
    expect(imageMimeFromBase64('')).toBe('image/jpeg');
    expect(imageMimeFromBase64('!!!')).toBe('image/jpeg');
  });
});

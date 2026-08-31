import { convertImageToPdf } from '../../src/shared/pdf-converter';
import { ValidationError } from '../../src/shared/errors';

describe('PDF Converter Utility', () => {
  // Minimal valid 1x1 JPEG base64
  const sampleJpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64'
  );

  // Minimal valid 1x1 PNG base64
  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  it('should successfully convert a valid JPEG buffer to a PDF buffer', async () => {
    const pdfBuffer = await convertImageToPdf(sampleJpg, 'image/jpeg');
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
    // Standard PDF file starts with '%PDF-'
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('should successfully convert a valid PNG buffer to a PDF buffer', async () => {
    const pdfBuffer = await convertImageToPdf(samplePng, 'image/png');
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('should accept uppercase or trimmed MIME types (e.g. IMAGE/JPEG)', async () => {
    const pdfBuffer = await convertImageToPdf(sampleJpg, '  IMAGE/JPEG  ');
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should throw ValidationError for unsupported content types', async () => {
    await expect(convertImageToPdf(Buffer.from('hello world'), 'text/plain')).rejects.toThrow(
      ValidationError
    );
    await expect(convertImageToPdf(Buffer.from('hello world'), 'application/pdf')).rejects.toThrow(
      ValidationError
    );
  });
});

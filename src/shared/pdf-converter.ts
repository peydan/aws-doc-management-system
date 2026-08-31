import { PDFDocument } from 'pdf-lib';
import { ValidationError } from './errors';

/**
 * Converts a raw JPEG or PNG image buffer into a single-page PDF buffer.
 * Preserves the exact aspect ratio and dimensions of the source image.
 *
 * @param imageBuffer Raw binary buffer of the image
 * @param contentType MIME type of the image (image/jpeg, image/jpg, image/png)
 * @returns Buffer containing the generated PDF binary
 */
export async function convertImageToPdf(imageBuffer: Buffer, contentType: string): Promise<Buffer> {
  const normalizedType = contentType.toLowerCase().trim();
  const pdfDoc = await PDFDocument.create();
  const imageBytes = new Uint8Array(imageBuffer);

  let embeddedImage;
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    embeddedImage = await pdfDoc.embedJpg(imageBytes);
  } else if (normalizedType === 'image/png') {
    embeddedImage = await pdfDoc.embedPng(imageBytes);
  } else {
    throw new ValidationError(
      `Format conversion to PDF is only supported for JPEG and PNG images (received: ${contentType})`
    );
  }

  // Create page with dimensions matching the embedded image
  const page = pdfDoc.addPage([embeddedImage.width, embeddedImage.height]);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width: embeddedImage.width,
    height: embeddedImage.height,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

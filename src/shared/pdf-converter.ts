import { PDFDocument } from 'pdf-lib';
import { ValidationError } from './errors';
import { convertDocxToPdf, isDocxContentType } from './docx-converter';

export { convertDocxToPdf, isDocxContentType };

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

/**
 * Normalizes content-type or filename into a standard lowercase format identifier (e.g. pdf, jpeg, png, docx, tiff).
 */
export function detectFileFormat(contentType?: string, filename?: string): string {
  const normType = (contentType || '').toLowerCase().trim();
  if (normType.includes('pdf')) return 'pdf';
  if (normType === 'image/jpeg' || normType === 'image/jpg') return 'jpeg';
  if (normType === 'image/png') return 'png';
  if (normType === 'image/tiff' || normType === 'image/tif') return 'tiff';
  if (normType === 'application/msword') return 'doc';
  if (isDocxContentType(normType)) return 'docx';
  if (normType === 'text/plain') return 'txt';

  if (filename) {
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      if (ext === 'jpg') return 'jpeg';
      if (ext === 'tif') return 'tiff';
      return ext;
    }
  }

  if (normType.startsWith('image/')) return normType.replace('image/', '');
  if (normType) return normType.split('/').pop() || 'binary';
  return 'binary';
}

/**
 * Inspects a PDF binary buffer and extracts its total page count.
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    return 0;
  }
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return pdfDoc.getPageCount();
  } catch (err: any) {
    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      return 1;
    }
    throw new ValidationError(`Failed to parse PDF binary to extract page count: ${err.message}`);
  }
}

/**
 * Checks if a given MIME type is supported for on-demand format conversion to PDF.
 * Supports JPEG/PNG images and MS Word (.docx) documents.
 */
export function isConvertibleToPdf(contentType: string): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().trim();
  return IMAGE_MIME_TYPES.includes(normalized) || isDocxContentType(normalized);
}

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
      `Format conversion to PDF is only supported for JPEG and PNG images, and MS Word (DOCX) documents (received: ${contentType})`
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

/**
 * Universal document-to-PDF converter.
 * Dispatches to image or DOCX converter based on the source content type.
 */
export async function convertDocumentToPdf(buffer: Buffer, contentType: string): Promise<Buffer> {
  const normalized = contentType.toLowerCase().trim();
  if (IMAGE_MIME_TYPES.includes(normalized)) {
    return convertImageToPdf(buffer, normalized);
  }
  if (isDocxContentType(normalized)) {
    return convertDocxToPdf(buffer);
  }
  throw new ValidationError(
    `Format conversion to PDF is only supported for JPEG and PNG images, and MS Word (DOCX) documents (received: ${contentType})`
  );
}

export interface GenericAddPagesOptions {
  /**
   * Raw binary buffer of the target/base PDF document.
   */
  sourcePdfBuffer: Buffer;

  /**
   * Raw binary buffer containing the pages or image to add.
   */
  pagesBuffer: Buffer;

  /**
   * MIME content type of the pagesBuffer ('application/pdf', 'image/jpeg', 'image/png', or Word docx).
   */
  pagesContentType: string;

  /**
   * Insertion position:
   * - 'end' (default): appends to the end of the document
   * - 'start': inserts at the beginning (page 0)
   * - number: 0-indexed page index where new pages will be inserted
   */
  position?: 'end' | 'start' | number;

  /**
   * Optional array of 0-indexed page numbers to extract from donor PDF.
   * If omitted, all pages from donor PDF are inserted.
   */
  pageIndices?: number[];
}

export interface AddPagesResult {
  pdfBuffer: Buffer;
  pageCountBefore: number;
  pageCountAfter: number;
  pagesAdded: number;
}

/**
 * Universal PDF page manipulation utility.
 * Appends or inserts pages from a donor PDF, image, or DOCX document into a target PDF.
 */
export async function addPagesToPdf(options: GenericAddPagesOptions): Promise<AddPagesResult> {
  const { sourcePdfBuffer, pagesBuffer, pagesContentType, position = 'end', pageIndices } = options;

  if (!sourcePdfBuffer || sourcePdfBuffer.length === 0) {
    throw new ValidationError('Source PDF buffer must not be empty');
  }
  if (!pagesBuffer || pagesBuffer.length === 0) {
    throw new ValidationError('Pages buffer to add must not be empty');
  }
  if (!pagesContentType) {
    throw new ValidationError('pagesContentType must be specified');
  }

  let targetDoc: PDFDocument;
  try {
    targetDoc = await PDFDocument.load(sourcePdfBuffer);
  } catch (err: any) {
    throw new ValidationError(`Failed to load base PDF document: ${err.message}`);
  }

  const pageCountBefore = targetDoc.getPageCount();

  // Normalize insertion index
  let insertIndex: number;
  if (position === 'start') {
    insertIndex = 0;
  } else if (typeof position === 'number') {
    if (position < 0) {
      throw new ValidationError(`Insertion position must be a non-negative integer (received ${position})`);
    }
    insertIndex = Math.min(position, pageCountBefore);
  } else {
    // 'end' or default
    insertIndex = pageCountBefore;
  }

  const normalizedDonorType = pagesContentType.toLowerCase().trim();
  let pagesAdded = 0;

  if (normalizedDonorType === 'application/pdf') {
    let donorDoc: PDFDocument;
    try {
      donorDoc = await PDFDocument.load(pagesBuffer);
    } catch (err: any) {
      throw new ValidationError(`Failed to load donor PDF pages: ${err.message}`);
    }

    const donorPageCount = donorDoc.getPageCount();
    if (donorPageCount === 0) {
      throw new ValidationError('Donor PDF contains no pages to add');
    }

    let indicesToCopy: number[];
    if (pageIndices && pageIndices.length > 0) {
      for (const idx of pageIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= donorPageCount) {
          throw new ValidationError(
            `Invalid page index ${idx}. Donor document has ${donorPageCount} pages (0 to ${donorPageCount - 1})`
          );
        }
      }
      indicesToCopy = pageIndices;
    } else {
      indicesToCopy = donorDoc.getPageIndices();
    }

    const copiedPages = await targetDoc.copyPages(donorDoc, indicesToCopy);
    for (const page of copiedPages) {
      targetDoc.insertPage(insertIndex++, page);
      pagesAdded++;
    }
  } else if (IMAGE_MIME_TYPES.includes(normalizedDonorType)) {
    const imageBytes = new Uint8Array(pagesBuffer);
    let embeddedImage;
    if (normalizedDonorType === 'image/png') {
      embeddedImage = await targetDoc.embedPng(imageBytes);
    } else {
      embeddedImage = await targetDoc.embedJpg(imageBytes);
    }

    const newPage = targetDoc.insertPage(insertIndex++, [embeddedImage.width, embeddedImage.height]);
    newPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: embeddedImage.width,
      height: embeddedImage.height,
    });
    pagesAdded = 1;
  } else if (isDocxContentType(normalizedDonorType)) {
    const convertedPdfBuffer = await convertDocxToPdf(pagesBuffer);
    const donorDoc = await PDFDocument.load(convertedPdfBuffer);
    const indicesToCopy = donorDoc.getPageIndices();
    const copiedPages = await targetDoc.copyPages(donorDoc, indicesToCopy);
    for (const page of copiedPages) {
      targetDoc.insertPage(insertIndex++, page);
      pagesAdded++;
    }
  } else {
    throw new ValidationError(
      `Unsupported content type for added pages: ${pagesContentType}. Supported types: application/pdf, image/jpeg, image/png, MS Word (.docx)`
    );
  }

  const modifiedBytes = await targetDoc.save();
  const pageCountAfter = targetDoc.getPageCount();

  return {
    pdfBuffer: Buffer.from(modifiedBytes),
    pageCountBefore,
    pageCountAfter,
    pagesAdded,
  };
}


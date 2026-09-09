import * as mammoth from 'mammoth';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { ValidationError } from './errors';

export const DOCX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/docx',
  'application/msword',
];

/**
 * Checks if the given MIME type corresponds to an MS Word DOCX document.
 */
export function isDocxContentType(contentType: string): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase().trim();
  return DOCX_MIME_TYPES.some((mime) => normalized.startsWith(mime));
}

/**
 * Normalizes common Unicode punctuation to WinAnsi equivalents
 * and replaces any unsupported characters to prevent pdf-lib encoding errors.
 */
function sanitizeForWinAnsi(text: string, font: PDFFont): string {
  if (!text) return '';
  const normalized = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, '    ');

  let sanitized = '';
  for (const char of normalized) {
    try {
      font.encodeText(char);
      sanitized += char;
    } catch {
      sanitized += '?';
    }
  }
  return sanitized;
}

/**
 * Converts a Microsoft Word (.docx) buffer into a formatted PDF buffer using mammoth and pdf-lib.
 *
 * @param docxBuffer Raw binary buffer of the DOCX file
 * @returns Promise<Buffer> Generated PDF binary buffer
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  if (!docxBuffer || docxBuffer.length === 0) {
    throw new ValidationError('Failed to convert DOCX to PDF: empty document buffer provided');
  }

  let markdownContent = '';
  try {
    const result = await (mammoth as any).convertToMarkdown({ buffer: docxBuffer });
    markdownContent = (result.value || '').trim();
  } catch (err: any) {
    throw new ValidationError(
      `Failed to convert DOCX to PDF: ${err?.message || 'invalid or corrupted DOCX archive'}`
    );
  }

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // Standard A4 points
  const pageHeight = 841.89;
  const margin = 54;
  const printableWidth = pageWidth - margin * 2;
  const bottomMargin = margin;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - margin;

  const rawLines = markdownContent.split(/\r?\n/);

  // If the document has no text content (empty document), provide placeholder text
  if (rawLines.length === 0 || (rawLines.length === 1 && !rawLines[0].trim())) {
    rawLines.push('*(Empty Document)*');
  }

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine) {
      // Paragraph spacing
      currentY -= 8;
      if (currentY < bottomMargin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        currentY = pageHeight - margin;
      }
      continue;
    }

    let font = regularFont;
    let size = 10.5;
    let lineHeight = 14;
    let text = rawLine;
    let indent = 0;

    if (text.startsWith('# ')) {
      font = boldFont;
      size = 18;
      lineHeight = 22;
      text = text.substring(2).trim();
      currentY -= 6;
    } else if (text.startsWith('## ')) {
      font = boldFont;
      size = 14;
      lineHeight = 18;
      text = text.substring(3).trim();
      currentY -= 4;
    } else if (text.startsWith('### ')) {
      font = boldFont;
      size = 12;
      lineHeight = 16;
      text = text.substring(4).trim();
      currentY -= 2;
    } else if (text.startsWith('- ') || text.startsWith('* ')) {
      text = '• ' + text.substring(2).trim();
      indent = 12;
    }

    // Strip inline markdown symbols like **bold** or _italic_
    text = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1');

    text = sanitizeForWinAnsi(text, font);

    // Word wrap text into printable width
    const words = text.split(/\s+/);
    let currentLine = '';
    const availableWidth = printableWidth - indent;

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width > availableWidth) {
        if (currentY - lineHeight < bottomMargin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          currentY = pageHeight - margin;
        }
        page.drawText(currentLine, {
          x: margin + indent,
          y: currentY,
          size,
          font,
          color: rgb(0.12, 0.12, 0.12),
        });
        currentY -= lineHeight;
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }

    if (currentLine) {
      if (currentY - lineHeight < bottomMargin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        currentY = pageHeight - margin;
      }
      page.drawText(currentLine, {
        x: margin + indent,
        y: currentY,
        size,
        font,
        color: rgb(0.12, 0.12, 0.12),
      });
      currentY -= lineHeight;
    }
  }

  // Footer: Dynamic page numbering across all generated pages
  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Page ${idx + 1} of ${pages.length}`, {
      x: pageWidth / 2 - 25,
      y: margin / 2,
      size: 9,
      font: regularFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

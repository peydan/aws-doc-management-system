import {
  convertImageToPdf,
  convertDocxToPdf,
  convertDocumentToPdf,
  isConvertibleToPdf,
  addPagesToPdf,
  detectFileFormat,
  getPdfPageCount,
} from '../../src/shared/pdf-converter';
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

  // Minimal valid DOCX base64 with Heading and Paragraphs
  const sampleDocx = Buffer.from(
    'UEsDBBQAAAAIAK9SKV31KchK6wAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCEX8XyFcUOHBBCSXrg5wgcygOs7E1i1X/yuqV9ezZt6QFVPdqz38xoutU+eLHDQi7FXt6rVgqMJlkXp15+r9+bJymoQrTgU8ReHpDkaujWh4wkmI3Uy7nW/Kw1mRkDkEoZIytjKgEqP8ukM5gNTKgf2vZRmxQrxtrUxUMO3SuOsPVVvO35+9SDcSleTndLVC8hZ+8MVJb1ouqrXEFPN8BdtP/aNedmisnjDc0u09054ZOHKc6i+IJSPyCwnf5JxWqbzDZwhLpd9EpeGkdn8MIvbrkkg0S8ePDqogRw8a+HPs49/AJQSwMEFAAAAAgAr1IpXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAd29yZC9kb2N1bWVudC54bWyFkM1qwzAQhF9l0Tm1lEBLEbFDGigt+FBI+wCKtXEMktaslLh++/qHuhQKvewiNPPtMNvdp3dwQ44NhVysMyUAQ0W2CXUuPt6f7x4FxGSCNY4C5qLHKHbFttOWqqvHkGAAhKi7XFxSarWUsbqgNzGjFsPwdyb2Jg1PrmVHbFumCmMc+N7JjVIP0psmiBF5ItuPu53GG0/rmHqH0Ombcbl4QTMmWwtZbOWimUYqDuQ9ctUYByWZAPuaEceIozRNBp5ty5HJeZKz/4mYqUPWv/QLHvaVRzgQt8QmDXVBmWz2DzsVcxRP15A0vJZH2KzulVoppf6wyu8S5E/BxRdQSwECFAMUAAAACACvUild9SnISusAAACtAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAK9SKV2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAARwBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAAAAAAAAAAACAAfIBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAAdAwAAAAA=',
    'base64'
  );

  describe('Image to PDF Conversion', () => {
    it('should successfully convert a valid JPEG buffer to a PDF buffer', async () => {
      const pdfBuffer = await convertImageToPdf(sampleJpg, 'image/jpeg');
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(0);
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
  });

  describe('DOCX to PDF Conversion', () => {
    it('should successfully convert a valid DOCX buffer to a PDF buffer', async () => {
      const pdfBuffer = await convertDocxToPdf(sampleDocx);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      const header = pdfBuffer.subarray(0, 5).toString('ascii');
      expect(header).toBe('%PDF-');
    });

    it('should throw ValidationError on empty buffer', async () => {
      await expect(convertDocxToPdf(Buffer.alloc(0))).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError on corrupted DOCX buffer', async () => {
      await expect(convertDocxToPdf(Buffer.from('not a docx zip file'))).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('Universal convertDocumentToPdf', () => {
    it('should convert JPEG via convertDocumentToPdf', async () => {
      const pdfBuffer = await convertDocumentToPdf(sampleJpg, 'image/jpeg');
      expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('should convert PNG via convertDocumentToPdf', async () => {
      const pdfBuffer = await convertDocumentToPdf(samplePng, 'image/png');
      expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('should convert DOCX via convertDocumentToPdf', async () => {
      const pdfBuffer = await convertDocumentToPdf(
        sampleDocx,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('should throw ValidationError for unsupported content types', async () => {
      await expect(convertDocumentToPdf(Buffer.from('hello world'), 'text/plain')).rejects.toThrow(
        ValidationError
      );
      await expect(
        convertDocumentToPdf(Buffer.from('hello world'), 'application/octet-stream')
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('isConvertibleToPdf helper', () => {
    it('should identify supported formats', () => {
      expect(isConvertibleToPdf('image/jpeg')).toBe(true);
      expect(isConvertibleToPdf('image/jpg')).toBe(true);
      expect(isConvertibleToPdf('image/png')).toBe(true);
      expect(
        isConvertibleToPdf(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true);
      expect(isConvertibleToPdf('application/docx')).toBe(true);
      expect(isConvertibleToPdf('application/msword')).toBe(true);
    });

    it('should reject unconvertible formats', () => {
      expect(isConvertibleToPdf('application/pdf')).toBe(false);
      expect(isConvertibleToPdf('text/plain')).toBe(false);
      expect(isConvertibleToPdf('image/gif')).toBe(false);
      expect(isConvertibleToPdf('')).toBe(false);
    });
  });

  describe('addPagesToPdf Universal Page Manager', () => {
    let basePdf: Buffer;

    beforeAll(async () => {
      basePdf = await convertImageToPdf(samplePng, 'image/png');
    });

    it('should append another PDF buffer to an existing PDF (default position end)', async () => {
      const donorPdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: donorPdf,
        pagesContentType: 'application/pdf',
      });

      expect(result.pageCountBefore).toBe(1);
      expect(result.pagesAdded).toBe(1);
      expect(result.pageCountAfter).toBe(2);
      expect(result.pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('should prepend pages at the beginning when position is "start"', async () => {
      const donorPdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: donorPdf,
        pagesContentType: 'application/pdf',
        position: 'start',
      });

      expect(result.pageCountBefore).toBe(1);
      expect(result.pagesAdded).toBe(1);
      expect(result.pageCountAfter).toBe(2);
    });

    it('should insert pages at a specific numeric index', async () => {
      const donorPdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: donorPdf,
        pagesContentType: 'application/pdf',
        position: 0,
      });

      expect(result.pageCountAfter).toBe(2);
    });

    it('should append a JPEG image directly as a new page', async () => {
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: sampleJpg,
        pagesContentType: 'image/jpeg',
      });

      expect(result.pageCountBefore).toBe(1);
      expect(result.pagesAdded).toBe(1);
      expect(result.pageCountAfter).toBe(2);
    });

    it('should append a PNG image directly as a new page', async () => {
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: samplePng,
        pagesContentType: 'image/png',
      });

      expect(result.pageCountBefore).toBe(1);
      expect(result.pagesAdded).toBe(1);
      expect(result.pageCountAfter).toBe(2);
    });

    it('should append a DOCX document as converted pages', async () => {
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: sampleDocx,
        pagesContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      expect(result.pageCountBefore).toBe(1);
      expect(result.pagesAdded).toBeGreaterThanOrEqual(1);
      expect(result.pageCountAfter).toBe(result.pageCountBefore + result.pagesAdded);
    });

    it('should filter donor pages when pageIndices is specified', async () => {
      // Create a 2-page donor PDF
      const intermediate = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: sampleJpg,
        pagesContentType: 'image/jpeg',
      });
      const twoPageDonor = intermediate.pdfBuffer;

      // Extract only page 1 from the 2-page donor
      const result = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: twoPageDonor,
        pagesContentType: 'application/pdf',
        pageIndices: [1],
      });

      expect(result.pagesAdded).toBe(1);
      expect(result.pageCountAfter).toBe(2);
    });

    it('should throw ValidationError on out-of-bounds pageIndices', async () => {
      const donorPdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      await expect(
        addPagesToPdf({
          sourcePdfBuffer: basePdf,
          pagesBuffer: donorPdf,
          pagesContentType: 'application/pdf',
          pageIndices: [99],
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError on empty buffers', async () => {
      await expect(
        addPagesToPdf({
          sourcePdfBuffer: Buffer.alloc(0),
          pagesBuffer: samplePng,
          pagesContentType: 'image/png',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        addPagesToPdf({
          sourcePdfBuffer: basePdf,
          pagesBuffer: Buffer.alloc(0),
          pagesContentType: 'image/png',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for unsupported donor content type', async () => {
      await expect(
        addPagesToPdf({
          sourcePdfBuffer: basePdf,
          pagesBuffer: Buffer.from('hello'),
          pagesContentType: 'text/plain',
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('detectFileFormat & getPdfPageCount', () => {
    it('detectFileFormat properly identifies standard MIME types and extensions', () => {
      expect(detectFileFormat('application/pdf')).toBe('pdf');
      expect(detectFileFormat('IMAGE/JPEG')).toBe('jpeg');
      expect(detectFileFormat('image/jpg')).toBe('jpeg');
      expect(detectFileFormat('image/png')).toBe('png');
      expect(detectFileFormat('image/tiff')).toBe('tiff');
      expect(detectFileFormat('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
      expect(detectFileFormat('application/docx')).toBe('docx');
      expect(detectFileFormat('application/msword')).toBe('doc');
      expect(detectFileFormat('text/plain')).toBe('txt');
      expect(detectFileFormat('', 'document.pdf')).toBe('pdf');
      expect(detectFileFormat('', 'photo.jpg')).toBe('jpeg');
      expect(detectFileFormat('', 'archive.tiff')).toBe('tiff');
      expect(detectFileFormat('', 'report.docx')).toBe('docx');
    });

    it('getPdfPageCount correctly counts pages in a single-page PDF', async () => {
      const singlePagePdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      const count = await getPdfPageCount(singlePagePdf);
      expect(count).toBe(1);
    });

    it('getPdfPageCount correctly counts pages in a multi-page PDF', async () => {
      const basePdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
      const twoPagePdf = await addPagesToPdf({
        sourcePdfBuffer: basePdf,
        pagesBuffer: samplePng,
        pagesContentType: 'image/png',
      });
      const count = await getPdfPageCount(twoPagePdf.pdfBuffer);
      expect(count).toBe(2);
    });

    it('getPdfPageCount returns 0 on empty buffer', async () => {
      const count = await getPdfPageCount(Buffer.alloc(0));
      expect(count).toBe(0);
    });
  });
});



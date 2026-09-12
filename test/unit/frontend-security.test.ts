import * as fs from 'fs';
import * as path from 'path';

describe('Frontend XSS Remediation Unit Tests (H1)', () => {
  const appJsPath = path.resolve(__dirname, '../../frontend/app.js');
  let appJsContent: string;
  let escapeHtmlFn: (str: any) => string;

  beforeAll(() => {
    appJsContent = fs.readFileSync(appJsPath, 'utf-8');

    // Extract escapeHtml definition from app.js
    const match = appJsContent.match(/function escapeHtml\(str\)\s*\{[\s\S]*?return String\(str\)[\s\S]*?\}/);
    expect(match).not.toBeNull();
    const fnCode = match![0];
    escapeHtmlFn = new Function(`${fnCode}; return escapeHtml;`)();
  });

  describe('escapeHtml utility', () => {
    it('should escape malicious HTML and script tags', () => {
      const payload = '<img src=x onerror=alert(1)>.pdf';
      const escaped = escapeHtmlFn(payload);
      expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;.pdf');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });

    it('should escape double and single quotes to prevent attribute breakout', () => {
      const payload = '" onfocus="alert(1)" \' test';
      const escaped = escapeHtmlFn(payload);
      expect(escaped).toBe('&quot; onfocus=&quot;alert(1)&quot; &#039; test');
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain("'");
    });

    it('should escape ampersands properly', () => {
      expect(escapeHtmlFn('A & B')).toBe('A &amp; B');
    });

    it('should safely handle null and undefined', () => {
      expect(escapeHtmlFn(null)).toBe('');
      expect(escapeHtmlFn(undefined)).toBe('');
    });

    it('should handle numeric and boolean inputs without throwing', () => {
      expect(escapeHtmlFn(12345)).toBe('12345');
      expect(escapeHtmlFn(true)).toBe('true');
    });
  });

  describe('Static analysis of DOM insertion in frontend/app.js', () => {
    it('should have escapeHtml called in showToast', () => {
      expect(appJsContent).toContain('toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;');
    });

    it('should sanitize filename in direct and add-pages file select feedback', () => {
      expect(appJsContent).toContain('${escapeHtml(selectedDirectFile.name)}');
      expect(appJsContent).toContain('${escapeHtml(selectedAddPagesFile.name)}');
    });

    it('should sanitize search table rendering', () => {
      expect(appJsContent).toContain('escapeHtml(rawDescriptor)');
      expect(appJsContent).toContain('${escapeHtml(doc.document_id)}');
      expect(appJsContent).toContain('${escapeHtml(doc.document_class || \'loan_agreement\')}');
      expect(appJsContent).toContain('${escapeHtml(doc.status || \'ACTIVE\')}');
    });

    it('should sanitize tool badges and citations in AI assistant', () => {
      expect(appJsContent).toContain('${escapeHtml(toolName)}');
      expect(appJsContent).toContain('${escapeHtml(cit.filename || \'Document\')}');
      expect(appJsContent).toContain('${escapeHtml(JSON.stringify(input || {}, null, 2))}');
    });
  });
});

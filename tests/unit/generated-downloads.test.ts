import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PRD_EXPORT_MIME_TYPES } from '../../src/lib/prd-export';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import { createPrdTemplateDocxResponse } from '../../src/pages/downloads/prd-template.docx';
import { createPrdTemplateMarkdownResponse } from '../../src/pages/downloads/prd-template.md';
import { createPrdTemplatePdfResponse } from '../../src/pages/downloads/prd-template.pdf';

describe('prerendered blank template responses', () => {
  it('returns a non-empty UTF-8 Markdown attachment with the canonical headings', async () => {
    const response = createPrdTemplateMarkdownResponse();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(PRD_EXPORT_MIME_TYPES.md);
    expect(response.headers.get('content-disposition')).toContain('prd-template.md');
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown.match(/^## /gm)).toHaveLength(12);
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(markdown).toContain(`## ${section.title}\n\n{${section.title}}`);
    }
  });

  it('returns a non-empty DOCX attachment that a ZIP parser reopens', async () => {
    const response = await createPrdTemplateDocxResponse();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file('word/document.xml')!.async('text');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(PRD_EXPORT_MIME_TYPES.docx);
    expect(response.headers.get('content-disposition')).toContain(
      'prd-template.docx',
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(documentXml).toContain(section.title.replace(/&/g, '&amp;'));
    }
  });

  it('returns a non-empty PDF attachment that pdf-lib reopens', async () => {
    const response = await createPrdTemplatePdfResponse();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(PRD_EXPORT_MIME_TYPES.pdf);
    expect(response.headers.get('content-disposition')).toContain('prd-template.pdf');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

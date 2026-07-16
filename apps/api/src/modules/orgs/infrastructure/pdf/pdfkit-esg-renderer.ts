import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { type EsgReport, type EsgReportRenderer } from '../../domain/esg-report';

/**
 * Renders an ESG report to PDF with PDFKit.
 *
 * PDFKit, not Puppeteer, on purpose: Puppeteer bundles ~300 MB of Chromium into every pod and
 * carries a browser's memory and security surface, which is at odds with the lean-container
 * production story. PDFKit is a pure-JS, deterministic writer with no native dependency. If a
 * richer HTML-templated design is ever needed, this is one class behind the EsgReportRenderer
 * port and can be swapped for a rendering microservice without touching the report figures.
 *
 * Deliberately plain and legible over decorative — a CSR filing is judged on the numbers and
 * their provenance, both of which are printed in full, including the disclaimer.
 */
@Injectable()
export class PdfKitEsgRenderer implements EsgReportRenderer {
  render(report: EsgReport): Promise<{ contentType: string; extension: string; body: Buffer }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 50,
          info: { Title: `ESG Report — ${report.orgName}` },
        });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () =>
          resolve({
            contentType: 'application/pdf',
            extension: 'pdf',
            body: Buffer.concat(chunks),
          }),
        );
        doc.on('error', reject);

        this.compose(doc, report);
        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private compose(doc: PDFKit.PDFDocument, report: EsgReport): void {
    const heading = (text: string) => doc.moveDown(0.8).fontSize(14).fillColor('#111').text(text);
    const label = (text: string) => doc.fontSize(9).fillColor('#666').text(text);
    const value = (text: string) => doc.fontSize(12).fillColor('#111').text(text);

    // Header.
    doc.fontSize(20).fillColor('#111').text('Recycling & Sustainability Report');
    doc.moveDown(0.2).fontSize(12).fillColor('#444').text(report.orgName);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(
        `${report.orgKind} • Period ${report.periodLabel} (${report.periodStart} to ${report.periodEnd})`,
      )
      .text(`Generated ${report.generatedAt} • ${report.memberCount} member(s)`);

    // Headline totals.
    heading('Estimated environmental impact (lifetime through this period)');
    const t = report.totals;
    label('Paper recycled');
    value(`${t.recycledKg} kg`);
    label('Landfill diverted (measured)');
    value(`${t.landfillDivertedKg} kg`);
    label('Estimated CO₂e avoided (EPA WARM model)');
    value(`${t.estimatedCo2eAvoidedKg} kg CO₂e`);
    label('Estimated water saved');
    value(`${t.estimatedWaterSavedLitres} litres`);
    label('Estimated energy saved');
    value(`${t.estimatedEnergySavedKwh} kWh`);
    label('Estimated trees-equivalent');
    value(`${t.estimatedTreesEquivalent}`);

    // Monthly trend, as a simple table.
    if (report.monthly.length > 0) {
      heading('Monthly trend');
      doc
        .fontSize(9)
        .fillColor('#666')
        .text('Month        Recycled (kg)     Est. CO₂e avoided (kg)');
      doc.fillColor('#111');
      for (const month of report.monthly) {
        doc.text(
          `${month.yearMonth}      ${month.recycledKg.toFixed(3).padStart(12)}     ${month.estimatedCo2eAvoidedKg
            .toFixed(3)
            .padStart(18)}`,
        );
      }
    }

    // Methodology — provenance for every figure.
    heading('Methodology & sources');
    for (const [metric, m] of Object.entries(report.methodology)) {
      doc.fontSize(9).fillColor('#444').text(`${metric} [${m.rigour}]: ${m.source}`);
      if (m.url.length > 0) doc.fillColor('#3366cc').text(m.url, { link: m.url, underline: true });
    }

    // Disclaimer — the honesty statement, on the document itself.
    heading('Important — the basis of these figures');
    doc.fontSize(8).fillColor('#666').text(report.disclaimer, { align: 'justify' });
  }
}

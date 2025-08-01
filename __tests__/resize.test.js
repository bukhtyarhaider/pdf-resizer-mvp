const request = require('supertest');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const app = require('../server');

describe('POST /resize', () => {
  it('resizes an uploaded PDF and returns a PDF', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([200, 200]);
    const pdfBytes = await pdfDoc.save();

    const orderNumber = 'test123';
    const fileNumber = '1';

    const res = await request(app)
      .post('/resize')
      .field('size', 'A1')
      .field('orderNumber', orderNumber)
      .field('fileNumber', fileNumber)
      .attach('pdf', Buffer.from(pdfBytes), 'test.pdf');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    await PDFDocument.load(res.body);

    const outputPath = path.join('processed', `Order${orderNumber}_File${fileNumber}.pdf`);
    expect(fs.existsSync(outputPath)).toBe(true);
    fs.unlinkSync(outputPath);
  });

  it('returns 400 when no PDF is provided', async () => {
    const res = await request(app)
      .post('/resize')
      .field('size', 'A1');

    expect(res.status).toBe(400);
  });
});

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

// Paper sizes in points
const PAPER_SIZES = {
  A0: { width: 2383.94, height: 3370.39 },
  A1: { width: 1683.78, height: 2383.94 },
  A2: { width: 1190.55, height: 1683.78 },
  A3: { width: 841.89, height: 1190.55 },
};

// Multer setup for handling file uploads
const upload = multer({ dest: "uploads/" });

app.use(express.static("public")); // For optional HTML UI

app.post("/resize", upload.single("pdf"), async (req, res) => {
  const size = req.body.size || "A1";
  const orderNumber = req.body.orderNumber || "0000";
  const fileNumber = req.body.fileNumber || "0";

  if (!req.file) return res.status(400).send("No PDF file uploaded.");

  const token = crypto.randomBytes(8).toString("hex");
  const inputPdfPath = req.file.path;
  const processedDir = "processed";

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir);
  }

  try {
    const inputBytes = await fs.promises.readFile(inputPdfPath);
    const inputPdf = await PDFDocument.load(inputBytes);
    const mergedPdf = await PDFDocument.create();
    const pageFiles = [];

    const targetSize = PAPER_SIZES[size];
    if (!targetSize) return res.status(400).send("Invalid paper size.");

    const { width: portraitWidth, height: portraitHeight } = targetSize;

    for (let i = 0; i < inputPdf.getPageCount(); i++) {
      const [copiedPage] = await mergedPdf.copyPages(inputPdf, [i]);
      const { width, height } = copiedPage.getSize();

      const isLandscape = width > height;
      const targetWidth = isLandscape ? portraitHeight : portraitWidth;
      const targetHeight = isLandscape ? portraitWidth : portraitHeight;
      const scale = Math.min(targetWidth / width, targetHeight / height);

      copiedPage.scale(scale, scale);
      mergedPdf.addPage(copiedPage);
    }

    const mergedFilename = `Order${orderNumber}_File${fileNumber}.pdf`;
    const mergedPath = path.join(processedDir, mergedFilename);
    const mergedBytes = await mergedPdf.save();
    await fs.promises.writeFile(mergedPath, mergedBytes);

    // Send file for download
    res.download(mergedPath, mergedFilename, () => {
      // Cleanup temp files
      fs.unlinkSync(inputPdfPath);
    });
  } catch (err) {
    console.error("Error processing PDF:", err);
    res.status(500).send("Internal server error.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

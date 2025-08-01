const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(session({
  secret: "pdf-secret",
  resave: false,
  saveUninitialized: true,
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Paper sizes in points
const PAPER_SIZES = {
  A0: { width: 2383.94, height: 3370.39 },
  A1: { width: 1683.78, height: 2383.94 },
  A2: { width: 1190.55, height: 1683.78 },
  A3: { width: 841.89, height: 1190.55 },
};

// Multer setup for handling file uploads
const upload = multer({ dest: "uploads/" });

// Enable CORS for client running on different port
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

const processingRecords = [];
const feedbacks = [];

async function processWithPdfLib(inputBytes, size) {
  const inputPdf = await PDFDocument.load(inputBytes);
  const mergedPdf = await PDFDocument.create();

  const targetSize = PAPER_SIZES[size];
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

  return mergedPdf.save();
}

async function processWithMock(inputBytes, size) {
  // For MVP we reuse pdf-lib implementation
  return processWithPdfLib(inputBytes, size);
}

const PROCESSORS = {
  "pdf-lib": processWithPdfLib,
  mock: processWithMock,
};

const USERS = { admin: "password" };

function authMiddleware(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/login");
}

app.use("/processed", authMiddleware, express.static("processed"));
app.use("/public", express.static("public"));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.status(401).json({ message: "Invalid credentials" });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/records", authMiddleware, (req, res) => {
  res.json({ records: processingRecords, feedbacks });
});

app.post("/feedback", authMiddleware, (req, res) => {
  const { id, status, note } = req.body;
  feedbacks.push({ id, status, note });
  res.json({ success: true });
});

app.get("/", authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/resize", authMiddleware, upload.single("pdf"), async (req, res) => {
  const size = req.body.size || "A1";
  const processor = req.body.processor || "pdf-lib";
  const orderNumber = req.body.orderNumber || "0000";
  const fileNumber = req.body.fileNumber || "0";

  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded." });
  }

  const token = crypto.randomBytes(8).toString("hex");
  const inputPdfPath = req.file.path;
  const processedDir = "processed";

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir);
  }

  try {
    const inputBytes = await fs.promises.readFile(inputPdfPath);
    const processFn = PROCESSORS[processor];
    const targetSize = PAPER_SIZES[size];
    if (!processFn || !targetSize) {
      fs.unlinkSync(inputPdfPath);
      return res.status(400).json({ error: "Invalid parameters." });
    }

    const start = Date.now();
    const mergedBytes = await processFn(inputBytes, size);
    const timeTaken = Date.now() - start;

    const mergedFilename = `Order${orderNumber}_File${fileNumber}.pdf`;
    const mergedPath = path.join(processedDir, mergedFilename);
    await fs.promises.writeFile(mergedPath, mergedBytes);

    const record = {
      id: token,
      file: req.file.originalname,
      processor,
      size,
      timeMs: timeTaken,
      processedFile: mergedFilename,
    };
    processingRecords.push(record);

    res.json({
      record,
      file: mergedBytes.toString("base64"),
    });

    fs.unlinkSync(inputPdfPath);
  } catch (err) {
    console.error("Error processing PDF:", err);
    fs.unlinkSync(inputPdfPath);
    res.status(500).json({ error: "Failed to process PDF: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
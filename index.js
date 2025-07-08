const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { createCanvas, loadImage, registerFont } = require('canvas');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files (frontend)
app.use(express.static('public'));
// Serve uploaded files (for template preview)
app.use('/uploads', express.static('uploads'));
// Parse JSON bodies
app.use(express.json());

// Helper: Parse CSV and return array of names
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const names = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Assume the first column is the name
        const name = Object.values(row)[0];
        if (name) names.push(name);
      })
      .on('end', () => resolve(names))
      .on('error', reject);
  });
}

// POST /upload-files: Upload template and CSV, return their unique filenames
app.post('/upload-files', upload.fields([
  { name: 'template', maxCount: 1 },
  { name: 'csv', maxCount: 1 }
]), (req, res) => {
  if (!req.files.template || !req.files.csv) {
    return res.json({ success: false });
  }
  // Optionally, rename files to unique names
  const templateFile = req.files.template[0];
  const csvFile = req.files.csv[0];
  const templateName = uuidv4() + path.extname(templateFile.originalname);
  const csvName = uuidv4() + path.extname(csvFile.originalname);
  fs.renameSync(templateFile.path, path.join('uploads', templateName));
  fs.renameSync(csvFile.path, path.join('uploads', csvName));
  res.json({ success: true, template: templateName, csv: csvName });
});

// POST /generate-certificates: Generate certificates and return ZIP
app.post('/generate-certificates', upload.fields([
  { name: 'template', maxCount: 1 },
  { name: 'csv', maxCount: 1 }
]), async (req, res) => {
  try {
    const templatePath = req.files.template[0].path;
    const csvPath = req.files.csv[0].path;
    const settings = JSON.parse(req.body.settings);

    // Load template image
    const templateImg = await loadImage(templatePath);

    // Enforce size limit
    if (templateImg.width > 500 || templateImg.height > 500) {
      // Clean up temp files
      fs.unlink(templatePath, () => {});
      fs.unlink(csvPath, () => {});
      return res.status(400).send('Template image size must not exceed 500px x 500px.');
    }

    // Parse CSV
    const names = await parseCSV(csvPath);

    // Prepare zip
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=certificates.zip');
    const archive = archiver('zip');
    archive.pipe(res);

    // For each name, generate certificate
    for (const name of names) {
      // Create canvas
      const canvas = createCanvas(templateImg.width, templateImg.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(templateImg, 0, 0, templateImg.width, templateImg.height);

      // Set font
      ctx.font = `${settings.fontSize}px "${settings.fontFamily}"`;
      ctx.fillStyle = '#222';
      ctx.textBaseline = 'top';

      // Draw name
      ctx.fillText(name, settings.x, settings.y - settings.fontSize);

      // Output as PNG buffer
      const buffer = canvas.toBuffer('image/png');
      archive.append(buffer, { name: `${name}.png` });
    }

    archive.finalize();

    // Cleanup temp files
    archive.on('end', () => {
      fs.unlink(templatePath, () => {});
      fs.unlink(csvPath, () => {});
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating certificates');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
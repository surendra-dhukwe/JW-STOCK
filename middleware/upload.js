const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(dir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + Math.round(Math.random()*1e9) + path.extname(file.originalname).toLowerCase())
});
module.exports = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed."));
    cb(null, true);
  }
});

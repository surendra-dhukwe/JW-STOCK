
const multer = require("multer");

// Store uploaded images in memory before sending to Cloudinary
const storage = multer.memoryStorage();

const upload = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024 // Maximum 5 MB
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new Error("Only JPG, PNG, WEBP and GIF images are allowed.")
      );
    }

    cb(null, true);
  }
});

module.exports = upload;

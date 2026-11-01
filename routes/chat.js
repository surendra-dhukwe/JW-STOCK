
const router = require("express").Router();
const Message = require("../models/Message");
const { auth } = require("../middleware/auth");
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");

router.use(auth);

// Get latest 100 messages
router.get("/", async (req, res) => {
  try {
    const messages = await Message.find()
      .populate("sender", "name role")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(messages.reverse());
  } catch (error) {
    console.error("Chat fetch error:", error);

    res.status(500).json({
      message: "Unable to load chat messages."
    });
  }
});

// Upload image to Cloudinary
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "jw-st/chat",
        resource_type: "image"
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

// Send text or image message
router.post("/", (req, res, next) => {
  upload.single("image")(req, res, error => {
    if (error) {
      return res.status(400).json({
        message: error.message || "Image upload failed."
      });
    }

    next();
  });
}, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();

    if (!text && !req.file) {
      return res.status(400).json({
        message: "Write a message or attach an image."
      });
    }

    let imageUrl = "";

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }

    const message = await Message.create({
      sender: req.user._id,
      text,
      image: imageUrl
    });

    await message.populate("sender", "name role");

    res.status(201).json({
      message: "Message sent successfully.",
      data: message
    });

  } catch (error) {
    console.error("Chat send error:", error);

    res.status(500).json({
      message: "Unable to send message."
    });
  }
});

module.exports = router;

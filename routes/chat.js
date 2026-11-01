
const router = require("express").Router();
const Message = require("../models/Message");
const { auth } = require("../middleware/auth");
const upload = require("../middleware/upload");

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
    res.status(500).json({ message: "Unable to load chat messages." });
  }
});

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

    const message = await Message.create({
      sender: req.user._id,
      text,
      image: req.file ? "/uploads/" + req.file.filename : ""
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

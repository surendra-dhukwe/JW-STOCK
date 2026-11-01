
const router = require("express").Router();
const Item = require("../models/Item");
const Transaction = require("../models/Transaction");
const { auth } = require("../middleware/auth");
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");
// const { Readable } = require("stream");

router.use(auth);

// Upload image to Cloudinary

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "jw-st/items",
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


// Get all items with approved stock totals
router.get("/", async (req, res) => {
  try {
    const items = await Item.find()
      .populate("createdBy", "name")
      .sort({ name: 1 })
      .lean();

    const totals = await Transaction.aggregate([
      { $match: { status: "approved" } },
      {
        $group: {
          _id: { item: "$item", type: "$type" },
          qty: { $sum: "$quantity" }
        }
      }
    ]);

    const map = {};

    totals.forEach(t => {
      const id = String(t._id.item);
      map[id] ||= { receive: 0, dispatch: 0 };

      map[id][
        t._id.type === "RECEIVE" ? "receive" : "dispatch"
      ] = t.qty;
    });

    res.json(
      items.map(i => ({
        ...i,
        stock:
          (map[String(i._id)]?.receive || 0) -
          (map[String(i._id)]?.dispatch || 0),
        received: map[String(i._id)]?.receive || 0,
        dispatched: map[String(i._id)]?.dispatch || 0
      }))
    );
  } catch (e) {
    console.error("Get items error:", e);
    res.status(500).json({ message: "Unable to load items." });
  }
});

// Any approved user can add an item
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
    const unit = String(req.body.unit || "").toUpperCase();

    if (!["PCS", "KG"].includes(unit)) {
      return res.status(400).json({
        message: "Choose PCS or KG as the item's unit."
      });
    }

    let imageUrl = "";

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }

    const item = await Item.create({
      code: req.body.code,
      name: req.body.name,
      unit,
      description: req.body.description || "",
      image: imageUrl,
      createdBy: req.user._id
    });

    res.status(201).json(item);

  } catch (e) {
    console.error("Create item error:", e);

    res.status(400).json({
      message:
        e.code === 11000
          ? "Item code already exists."
          : e.message || "Unable to create item."
    });
  }
});

module.exports = router;


const router = require("express").Router();
const mongoose = require("mongoose");

const Item = require("../models/Item");
const Transaction = require("../models/Transaction");
const Message = require("../models/Message");
const { auth, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");

router.use(auth);

// ---------------- IMAGE UPLOAD ----------------

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

function handleImageUpload(req, res, next) {
  upload.single("image")(req, res, error => {
    if (error) {
      return res.status(400).json({
        message: error.message || "Image upload failed."
      });
    }
    next();
  });
}

// ---------------- GET ALL ITEMS ----------------

// ---------------- GET ALL ITEMS (OPTIMIZED) ----------------

router.get("/", async (req, res) => {
  try {
    const items = await Item.find()
      .populate("createdBy", "name")
      .populate("updatedBy", "name username")
      .sort({ name: 1 })
      .lean();

    if (!items.length) {
      return res.json([]);
    }

    const itemIds = items.map(item => item._id);

    const totals = await Transaction.aggregate([
      {
        $match: {
          status: "approved",
          item: { $in: itemIds }
        }
      },
      {
        $group: {
          _id: {
            item: "$item",
            type: "$type"
          },
          qty: { $sum: "$quantity" }
        }
      }
    ]);

    const map = new Map();

    for (const row of totals) {
      const id = String(row._id.item);

      if (!map.has(id)) {
        map.set(id, {
          receive: 0,
          dispatch: 0
        });
      }

      const stock = map.get(id);

      if (row._id.type === "RECEIVE") {
        stock.receive = row.qty;
      }

      if (row._id.type === "DISPATCH") {
        stock.dispatch = row.qty;
      }
    }

    const result = items.map(item => {
      const stock = map.get(String(item._id)) || {
        receive: 0,
        dispatch: 0
      };

      return {
        ...item,
        stock: stock.receive - stock.dispatch,
        received: stock.receive,
        dispatched: stock.dispatch
      };
    });

    return res.json(result);

  } catch (error) {
    console.error("Get items error:", error);

    return res.status(500).json({
      message: "Unable to load items."
    });
  }
});

// ---------------- ITEM HISTORY ----------------

// Get item movement history with filters and pagination
router.get("/:id/history", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid item ID."
      });
    }

    const item = await Item.findById(id)
      .populate("createdBy", "name")
      .lean();

    if (!item) {
      return res.status(404).json({
        message: "Item not found."
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 25)
    );

    const filter = {
      item: new mongoose.Types.ObjectId(id)
    };

    const type = String(req.query.type || "").toUpperCase();
    const status = String(req.query.status || "").toLowerCase();

    if (["RECEIVE", "DISPATCH"].includes(type)) {
      filter.type = type;
    }

    if (["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    if (req.query.from || req.query.to) {
      filter.createdAt = {};

      if (req.query.from) {
        const from = new Date(req.query.from);

        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({
            message: "Invalid start date."
          });
        }

        filter.createdAt.$gte = from;
      }

      if (req.query.to) {
        const to = new Date(req.query.to);

        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({
            message: "Invalid end date."
          });
        }

        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const [entries, total, summary] = await Promise.all([
      Transaction.find(filter)
        .populate("createdBy", "name username")
        .populate("reviewedBy", "name username")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Transaction.countDocuments(filter),

      Transaction.aggregate([
        {
          $match: {
            item: new mongoose.Types.ObjectId(id),
            status: "approved"
          }
        },
        {
          $group: {
            _id: "$type",
            quantity: { $sum: "$quantity" },
            entries: { $sum: 1 }
          }
        }
      ])
    ]);

    const received =
      summary.find(row => row._id === "RECEIVE")?.quantity || 0;

    const dispatched =
      summary.find(row => row._id === "DISPATCH")?.quantity || 0;

    res.json({
      item,
      summary: {
        received,
        dispatched,
        currentStock: received - dispatched
      },
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Item history error:", error);

    res.status(500).json({
      message: "Unable to load item history."
    });
  }
});

// Get complete details of one history entry
router.get("/:id/history/:transactionId", async (req, res) => {
  try {
    const { id, transactionId } = req.params;

    if (
      !mongoose.isValidObjectId(id) ||
      !mongoose.isValidObjectId(transactionId)
    ) {
      return res.status(400).json({
        message: "Invalid item or transaction ID."
      });
    }

    const item = await Item.findById(id).select("code name unit image");

    if (!item) {
      return res.status(404).json({
        message: "Item not found."
      });
    }

    const entry = await Transaction.findOne({
      _id: transactionId,
      item: id
    })
      .populate("createdBy", "name username")
      .populate("reviewedBy", "name username")
      .populate("item", "code name unit image")
      .lean();

    if (!entry) {
      return res.status(404).json({
        message: "History entry not found."
      });
    }

    res.json({
      item,
      entry
    });
  } catch (error) {
    console.error("History detail error:", error);

    res.status(500).json({
      message: "Unable to load transaction details."
    });
  }
});

// ---------------- CREATE ITEM ----------------

router.post("/", handleImageUpload, async (req, res) => {
  try {
    const unit = String(req.body.unit || "PCS").toUpperCase();

    if (!["PCS", "KG"].includes(unit)) {
      return res.status(400).json({
        message: "Choose PCS or KG as the item's unit."
      });
    }

    const code = String(req.body.code || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();

    if (!code || !name) {
      return res.status(400).json({
        message: "Item code and item name are required."
      });
    }

    let imageUrl = "";

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }

    const item = await Item.create({
      code,
      name,
      unit,
      description: String(req.body.description || ""),
      category: String(req.body.category || ""),
      brand: String(req.body.brand || ""),
      specifications: String(req.body.specifications || ""),
      location: String(req.body.location || ""),
      minimumStock: Number(req.body.minimumStock || 0),
      image: imageUrl,
      createdBy: req.user._id
    });

    res.status(201).json({
      message: "Item created successfully.",
      item
    });
  } catch (error) {
    console.error("Create item error:", error);

    res.status(400).json({
      message:
        error.code === 11000
          ? "Item code already exists."
          : error.message || "Unable to create item."
    });
  }
});

// ---------------- UPDATE ITEM ----------------

router.patch("/:id", handleImageUpload, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid item ID."
      });
    }

    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        message: "Item not found."
      });
    }

    const oldCode = item.code;
    const oldName = item.name;

    const allowedFields = [
      "code",
      "name",
      "unit",
      "description",
      "category",
      "brand",
      "specifications",
      "location",
      "minimumStock"
    ];

    const changedFields = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        let newValue;

        if (field === "unit") {
          newValue = String(req.body.unit).toUpperCase();

          if (!["PCS", "KG"].includes(newValue)) {
            return res.status(400).json({
              message: "Unit must be PCS or KG."
            });
          }
        } else if (field === "code") {
          newValue = String(req.body.code).trim().toUpperCase();
        } else if (field === "name") {
          newValue = String(req.body.name).trim();
        } else if (field === "minimumStock") {
          newValue = Number(req.body.minimumStock);

          if (!Number.isFinite(newValue) || newValue < 0) {
            return res.status(400).json({
              message: "Minimum stock must be zero or greater."
            });
          }
        } else {
          newValue = String(req.body[field]);
        }

        if (String(item[field] ?? "") !== String(newValue ?? "")) {
          changedFields.push(field);
        }

        item[field] = newValue;
      }
    }

    if (!item.code || !item.name) {
      return res.status(400).json({
        message: "Item code and item name are required."
      });
    }

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      item.image = result.secure_url;
      changedFields.push("image");
    }

    if (changedFields.length > 0) {
      item.updatedBy = req.user._id;
      item.lastEditedAt = new Date();

      await item.save();

      await item.populate("createdBy", "name");
      await item.populate("updatedBy", "name username");

      try {
        const editorName =
          req.user.name || item.updatedBy?.name || "A team member";

        const activityText =
          `✏️ ${editorName} updated an item: ` +
          `${oldCode} — ${oldName}. ` +
          `Updated fields: ${changedFields.join(", ")}. ` +
          `Current item: ${item.code} — ${item.name}`;

        await Message.create({
          sender: req.user._id,
          text: activityText
        });
      } catch (chatError) {
        console.error("Item activity message error:", chatError);
      }
    }

    res.json({
      message: "Item updated successfully.",
      item
    });
  } catch (error) {
    console.error("Update item error:", error);

    res.status(400).json({
      message:
        error.code === 11000
          ? "This item code is already used by another item."
          : error.message || "Unable to update item."
    });
  }
});

// ---------------- ADMIN ONLY: DELETE ITEM ----------------

router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid item ID." });
    }

    const item = await Item.findById(id);

    if (!item) {
      return res.status(404).json({ message: "Item not found." });
    }

    // History must be deleted first.
    const hasHistory = await Transaction.exists({ item: id });

    if (hasHistory) {
      return res.status(409).json({
        message:
          "This item has transaction history. Delete its reviewed entries first."
      });
    }

    await Item.deleteOne({ _id: id });

    return res.json({
      message: `Item ${item.code} deleted successfully.`
    });
  } catch (error) {
    console.error("Delete item error:", error);

    return res.status(500).json({
      message: "Unable to delete item."
    });
  }
});

module.exports = router;


const router = require("express").Router();

const mongoose = require("mongoose");
const InvoiceDraft = require("../models/InvoiceDraft");
const { auth } = require("../middleware/auth");

router.use(auth);

// ---------------- COMMON HELPERS ----------------

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getUserId(req) {
  const id = req.user?._id || req.user?.id;

  if (!id) {
    throw createError("User authentication required.", 401);
  }

  return id;
}

function optionalNumber(value, fieldName, wholeNumber = false) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw createError(`${fieldName} must be zero or a positive number.`);
  }

  if (wholeNumber && !Number.isSafeInteger(number)) {
    throw createError(`${fieldName} must be a whole number.`);
  }

  return number;
}

// ---------------- CLEAN DRAFT ITEMS ----------------

function cleanItems(items) {
  if (!Array.isArray(items)) {
    throw createError("Invoice items must be an array.");
  }

  if (items.length > 100) {
    throw createError("Maximum 100 invoice rows are allowed.");
  }

  return items.map((entry = {}) => {
    const itemId = entry.itemId
      ? String(entry.itemId)
      : null;

    if (itemId && !mongoose.isValidObjectId(itemId)) {
      throw createError("Invalid Item Master selection.");
    }

    const qnt = optionalNumber(entry.qnt, "QNT", true);
    const bags = optionalNumber(entry.bags, "BAGS", true);

    const bagPerKg = optionalNumber(
      entry.bagPerKg,
      "BAG PR KG"
    );

    const manualTotalQuantity =
      Boolean(entry.manualTotalQuantity);

    const manualTotalKg =
      Boolean(entry.manualTotalKg);

    let totalQuantity = optionalNumber(
      entry.totalQuantity ?? entry.quantity,
      "TOT. QNT",
      true
    );

    let totalKg = optionalNumber(
      entry.totalKg,
      "TOT. K.G."
    );

    // Automatically calculate totals unless manually edited.
    if (!manualTotalQuantity) {
      totalQuantity =
        qnt !== null && bags !== null
          ? qnt * bags
          : null;
    }

    if (!manualTotalKg) {
      totalKg =
        bags !== null && bagPerKg !== null
          ? bags * bagPerKg
          : null;
    }

    return {
      itemId,
      code: String(entry.code || "")
        .trim()
        .toUpperCase()
        .slice(0, 50),

      name: String(entry.name || "")
        .trim()
        .slice(0, 200),

      qnt,
      bags,
      bagPerKg,
      totalQuantity,
      totalKg,
      manualTotalQuantity,
      manualTotalKg
    };
  });
}

// ---------------- DRAFT DATA ----------------

function getDraftData(body = {}) {
  const type = String(
    body.type || "RECEIVE"
  ).toUpperCase();

  if (!["RECEIVE", "DISPATCH"].includes(type)) {
    throw createError("Invalid transaction type.");
  }

  let invoiceDate = null;

  if (body.invoiceDate) {
    const parsedDate = new Date(body.invoiceDate);

    if (Number.isNaN(parsedDate.getTime())) {
      throw createError("Invalid invoice date.");
    }

    invoiceDate = parsedDate;
  }

  return {
    type,

    invoiceNumber: String(body.invoiceNumber || "")
      .trim()
      .slice(0, 80),

    invoiceDate,

    note: String(body.note || "")
      .trim()
      .slice(0, 1000),

    items: cleanItems(body.items || []),

    lastSavedAt: new Date()
  };
}

function ownerFilter(req) {
  return {
    _id: req.params.id,
    createdBy: getUserId(req)
  };
}

// ---------------- GET ALL USER DRAFTS ----------------

router.get("/", async (req, res, next) => {
  try {
    const drafts = await InvoiceDraft.find({
      createdBy: getUserId(req)
    })
      .sort({ updatedAt: -1 })
      .lean();

    res.json(drafts);
  } catch (error) {
    next(error);
  }
});

// ---------------- GET SINGLE DRAFT ----------------

router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid draft ID.");
    }

    const draft = await InvoiceDraft.findOne(
      ownerFilter(req)
    ).lean();

    if (!draft) {
      throw createError("Draft not found.", 404);
    }

    res.json(draft);
  } catch (error) {
    next(error);
  }
});

// ---------------- CREATE DRAFT ----------------

router.post("/", async (req, res, next) => {
  try {
    const data = getDraftData(req.body);

    const draft = await InvoiceDraft.create({
      ...data,
      createdBy: getUserId(req)
    });

    res.status(201).json({
      message: "Invoice draft saved successfully.",
      draft
    });
  } catch (error) {
    next(error);
  }
});

// ---------------- UPDATE / AUTOSAVE DRAFT ----------------

router.patch("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid draft ID.");
    }

    const data = getDraftData(req.body);

    const draft = await InvoiceDraft.findOneAndUpdate(
      ownerFilter(req),
      {
        $set: data
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!draft) {
      throw createError("Draft not found.", 404);
    }

    res.json({
      message: "Invoice draft updated successfully.",
      draft
    });
  } catch (error) {
    next(error);
  }
});

// ---------------- DELETE DRAFT ----------------

router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid draft ID.");
    }

    const draft = await InvoiceDraft.findOneAndDelete(
      ownerFilter(req)
    );

    if (!draft) {
      throw createError("Draft not found.", 404);
    }

    res.json({
      message: "Invoice draft deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

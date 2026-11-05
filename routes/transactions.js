
const router = require("express").Router();
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Transaction = require("../models/Transaction");
const Item = require("../models/Item");
const { auth, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");

router.use(auth);


// ---------------- DASHBOARD SUMMARY ----------------

router.get("/summary", async (req, res) => {
  try {
    const match = req.user.role === "admin"
      ? {}
      : { createdBy: req.user._id };

    const totals = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            status: "$status",
            type: "$type"
          },
          quantity: { $sum: "$quantity" },
          count: { $sum: 1 }
        }
      }
    ]);

    const summary = {
      pending: 0,
      receive: 0,
      dispatch: 0
    };

    for (const row of totals) {
      if (row._id.status === "pending") {
        summary.pending += row.count;
      }

      if (row._id.status === "approved" && row._id.type === "RECEIVE") {
        summary.receive += row.quantity;
      }

      if (row._id.status === "approved" && row._id.type === "DISPATCH") {
        summary.dispatch += row.quantity;
      }
    }

    return res.json(summary);
  } catch (error) {
    console.error("Dashboard summary error:", error);
    return res.status(500).json({
      message: "Unable to load dashboard summary."
    });
  }
});

// ---------------- RECENT TRANSACTIONS ----------------

router.get("/recent", async (req, res) => {
  try {
    const filter = req.user.role === "admin"
      ? {}
      : { createdBy: req.user._id };

    const rows = await Transaction.find(filter)
      .populate("item", "code name image unit")
      .populate("createdBy", "name username")
      .populate("reviewedBy", "name")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    return res.json(rows);
  } catch (error) {
    console.error("Recent transactions error:", error);
    return res.status(500).json({
      message: "Unable to load recent transactions."
    });
  }
});

// ---------------- COMMON ERROR ----------------

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ---------------- IMAGE UPLOAD ----------------

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "jw-st/transactions",
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

// ---------------- INPUT VALIDATION ----------------

function parseInvoiceDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError("Invalid invoice date.");
  }

  return date;
}

function normalizeInvoiceEntry(entry) {
  const qnt = Number(entry.qnt ?? entry.quantity);
  const bags = Number(entry.bags ?? 1);
  const bagPerKg = Number(entry.bagPerKg ?? 0);

  if (!Number.isSafeInteger(qnt) || qnt < 1) {
    throw createError("QNT must be a positive whole number.");
  }

  if (!Number.isSafeInteger(bags) || bags < 1) {
    throw createError("BAGS must be a positive whole number.");
  }

  if (!Number.isFinite(bagPerKg) || bagPerKg < 0) {
    throw createError("BAG PR KG must be a valid non-negative number.");
  }

  const totalQuantity = qnt * bags;
  const totalKg = bags * bagPerKg;

  if (!Number.isSafeInteger(totalQuantity) || totalQuantity < 1) {
    throw createError("Calculated TOT. QNT. is too large.");
  }

  if (!Number.isFinite(totalKg)) {
    throw createError("Calculated TOT. K.G. is invalid.");
  }

  return {
    qnt,
    bags,
    bagPerKg,
    totalKg,
    totalQuantity,
    quantity: totalQuantity
  };
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw createError("Add at least one item to the invoice.");
  }

  if (entries.length > 100) {
    throw createError("Maximum 100 items are allowed in one invoice.");
  }

  return entries.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw createError("Invalid invoice item.");
    }

    // Every invoice row must refer to an existing Item Master item.
    if (!entry.itemId || !mongoose.isValidObjectId(String(entry.itemId))) {
      throw createError(
        "Select an existing item from Item Master for every invoice row."
      );
    }

    return {
      ...entry,
      ...normalizeInvoiceEntry(entry)
    };
  });
}

// ---------------- STOCK CALCULATION ----------------

async function getAvailableStock(itemId, session) {
  const totals = await Transaction.aggregate([
    {
      $match: {
        item: new mongoose.Types.ObjectId(String(itemId)),
        status: "approved"
      }
    },
    {
      $group: {
        _id: "$type",
        quantity: { $sum: "$quantity" }
      }
    }
  ]).session(session);

  let received = 0;
  let dispatched = 0;

  for (const row of totals) {
    if (row._id === "RECEIVE") received = row.quantity;
    if (row._id === "DISPATCH") dispatched = row.quantity;
  }

  return received - dispatched;
}

// ---------------- EXISTING ITEM LOOKUP ONLY ----------------

async function findExistingItem(entry, session) {
  if (!entry.itemId || !mongoose.isValidObjectId(String(entry.itemId))) {
    throw createError(
      "Select an existing item from Item Master."
    );
  }

  const item = await Item.findById(entry.itemId).session(session);

  if (!item) {
    throw createError(
      "Selected item was not found in Item Master."
    );
  }

  // Verify that submitted CODE belongs to the selected item.
  const submittedCode = String(entry.code || "").trim().toUpperCase();
  const actualCode = String(item.code || "").trim().toUpperCase();

  if (submittedCode && submittedCode !== actualCode) {
    throw createError(
      "Selected item CODE does not match Item Master. Please select the item again."
    );
  }

  // Item photo is optional.
  // If available, it will automatically appear in the invoice.
  // If unavailable, the transaction can still be submitted.

  return item;
}

// ---------------- ITEM LOCK ----------------

async function lockItems(itemIds, session) {
  const sortedIds = [...new Set(itemIds.map(String))].sort();

  for (const itemId of sortedIds) {
    const result = await Item.updateOne(
      { _id: itemId },
      { $inc: { stockVersion: 1 } },
      { session }
    );

    if (result.matchedCount !== 1) {
      throw createError(`Item not found: ${itemId}`, 404);
    }
  }

  return sortedIds;
}

// ---------------- GET TRANSACTIONS (OPTIMIZED) ----------------

router.get("/", async (req, res) => {
  try {
    const filter =
      req.user.role === "admin"
        ? {}
        : { createdBy: req.user._id };

    const rows = await Transaction.find(filter)
      .populate("item", "code name image unit description")
      .populate("createdBy", "name username")
      .populate("reviewedBy", "name")
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    return res.json(rows);
  } catch (error) {
    console.error("Get transactions error:", error);

    return res.status(500).json({
      message: "Unable to load transactions."
    });
  }
});

// ---------------- CREATE INVOICE ----------------

router.post(
  "/",
  (req, res, next) => {
    upload.single("image")(req, res, error => {
      if (error) {
        return res.status(400).json({
          message: error.message || "Image upload failed."
        });
      }

      next();
    });
  },
  async (req, res) => {
    let session;

    try {
      const type = String(req.body.type || "").trim().toUpperCase();

      if (!["RECEIVE", "DISPATCH"].includes(type)) {
        return res.status(400).json({
          message: "Invalid transaction type."
        });
      }

      let entries = [];

      if (req.body.items) {
        try {
          entries = JSON.parse(req.body.items);
        } catch {
          return res.status(400).json({
            message: "Invalid items data."
          });
        }
      } else if (req.body.itemId) {
        entries = [
          {
            itemId: req.body.itemId,
            qnt: req.body.quantity,
            bags: 1,
            bagPerKg: 0
          }
        ];
      }

      entries = validateEntries(entries);

      const invoiceDate = parseInvoiceDate(req.body.invoiceDate);

      const invoiceNumber = String(req.body.invoiceNumber || "")
        .trim()
        .slice(0, 80);

      const note = String(req.body.note || "").slice(0, 1000);

      // Optional invoice-level attachment.
      // Item row photos always come from Item Master.
      let imageUrl = "";

      if (req.file) {
        const result = await uploadToCloudinary(req.file.buffer);
        imageUrl = result.secure_url;
      }

      session = await mongoose.startSession();

      let responseData = null;

      await session.withTransaction(async () => {
        const normalized = [];

        for (const entry of entries) {
          const item = await findExistingItem(entry, session);

          normalized.push({
            item: item._id,
            qnt: entry.qnt,
            bags: entry.bags,
            bagPerKg: entry.bagPerKg,
            totalKg: entry.totalKg,
            totalQuantity: entry.totalQuantity,
            quantity: entry.totalQuantity
          });
        }

        // Combine repeated item IDs for stock validation.
        // const requestedByItem = new Map();

        // for (const entry of normalized) {
        //   const key = String(entry.item);

        //   const nextQuantity =
        //     (requestedByItem.get(key) || 0) + entry.quantity;

        //   if (!Number.isSafeInteger(nextQuantity)) {
        //     throw createError("Combined item quantity is too large.");
        //   }

        //   requestedByItem.set(key, nextQuantity);
        // }

        // Check approved stock for DISPATCH.
        // if (type === "DISPATCH") {
        //   for (const [itemId, requested] of requestedByItem) {
        //     const available = await getAvailableStock(itemId, session);

        //     if (available < requested) {
        //       const item = await Item.findById(itemId).session(session);

        //       throw createError(
        //         `Insufficient stock for ${item?.code || itemId} - ` +
        //         `${item?.name || ""}. Available: ${available}, ` +
        //         `requested: ${requested}.`
        //       );
        //     }
        //   }
        // }

        const batchId = randomUUID();

        const documents = normalized.map(entry => ({
          item: entry.item,
          type,

          qnt: entry.qnt,
          bags: entry.bags,
          bagPerKg: entry.bagPerKg,
          totalKg: entry.totalKg,
          totalQuantity: entry.totalQuantity,

          // Stock quantity is always TOT. QNT.
          quantity: entry.totalQuantity,

          batchId,
          invoiceNumber,
          invoiceDate,
          note,
          image: imageUrl,
          createdBy: req.user._id,
          status: "pending"
        }));

        const created = await Transaction.insertMany(
          documents,
          { session }
        );

        responseData = {
          message:
            `${created.length} item entries sent together for admin approval.`,
          batchId,
          invoiceNumber,
          totalItems: created.length,
          totalQuantity: created.reduce(
            (sum, row) => sum + row.totalQuantity,
            0
          ),
          totalKg: created.reduce(
            (sum, row) => sum + row.totalKg,
            0
          ),
          transactions: created
        };
      });

      return res.status(201).json(responseData);
    } catch (error) {
      console.error("Create transaction error:", error);

      return res.status(error.status || 500).json({
        message: error.message || "Could not create invoice."
      });
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }
);

// ---------------- APPROVE / REJECT INVOICE BATCH ----------------

router.patch("/batch/:batchId/review", adminOnly, async (req, res) => {
  let session;

  try {
    const decision = String(req.body.decision || "").toLowerCase();

    const reason = String(
      req.body.reason || "Rejected by admin"
    ).slice(0, 300);

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        message: "Invalid decision."
      });
    }

    if (!req.params.batchId || req.params.batchId.length > 100) {
      return res.status(400).json({
        message: "Invalid invoice batch ID."
      });
    }

    session = await mongoose.startSession();

    let reviewedCount = 0;

    await session.withTransaction(async () => {
      const rows = await Transaction.find({
        batchId: req.params.batchId
      }).session(session);

      if (!rows.length) {
        throw createError("Invoice batch not found.", 404);
      }

      if (rows.some(row => row.status !== "pending")) {
        throw createError(
          "This invoice has already been reviewed. All entries must be pending.",
          409
        );
      }

      const invoiceType = rows[0].type;

      if (rows.some(row => row.type !== invoiceType)) {
        throw createError(
          "Invoice contains inconsistent transaction types.",
          409
        );
      }

      const itemIds = rows.map(row => row.item);
      await lockItems(itemIds, session);

      // if (decision === "approve" && invoiceType === "DISPATCH") {
      //   const requestedByItem = new Map();

      //   for (const row of rows) {
      //     const itemId = String(row.item);

      //     const total =
      //       (requestedByItem.get(itemId) || 0) + row.quantity;

      //     if (!Number.isSafeInteger(total)) {
      //       throw createError("Invoice quantity total is too large.");
      //     }

      //     requestedByItem.set(itemId, total);
      //   }

      //   for (const [itemId, requested] of requestedByItem) {
      //     const available = await getAvailableStock(itemId, session);
      //     const item = await Item.findById(itemId).session(session);

      //     if (available < requested) {
      //       throw createError(
      //         `Cannot approve invoice. Insufficient stock for ` +
      //         `${item?.code || itemId}. Available: ${available}, ` +
      //         `requested: ${requested}. No invoice entries were approved.`
      //       );
      //     }
      //   }
      // }

      const newStatus =
        decision === "approve" ? "approved" : "rejected";

      const result = await Transaction.updateMany(
        {
          _id: { $in: rows.map(row => row._id) },
          status: "pending"
        },
        {
          $set: {
            status: newStatus,
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
            rejectionReason: decision === "reject" ? reason : ""
          }
        },
        { session }
      );

      if (result.modifiedCount !== rows.length) {
        throw createError(
          "Invoice review conflict. Please refresh and try again.",
          409
        );
      }

      reviewedCount = rows.length;
    });

    return res.json({
      message:
        `Invoice ${decision === "approve" ? "approved" : "rejected"} successfully. ` +
        `${reviewedCount} item entries reviewed together.`,
      reviewedCount
    });
  } catch (error) {
    console.error("Invoice review error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Unable to review invoice."
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

// ---------------- LEGACY SINGLE ENTRY REVIEW ----------------

router.patch("/:id/review", adminOnly, async (req, res) => {
  let session;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid transaction ID."
      });
    }

    const decision = String(req.body.decision || "").toLowerCase();

    const reason = String(
      req.body.reason || "Rejected by admin"
    ).slice(0, 300);

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        message: "Invalid decision."
      });
    }

    session = await mongoose.startSession();

    let responseTransaction = null;

    await session.withTransaction(async () => {
      const tx = await Transaction.findById(req.params.id).session(session);

      if (!tx) {
        throw createError("Transaction not found.", 404);
      }

      if (tx.batchId) {
        throw createError(
          "This entry belongs to an invoice. Please review the complete invoice batch.",
          409
        );
      }

      if (tx.status !== "pending") {
        throw createError("This entry has already been reviewed.", 409);
      }

      await lockItems([tx.item], session);

      // if (decision === "approve" && tx.type === "DISPATCH") {
      //   const available = await getAvailableStock(tx.item, session);

      //   if (available < tx.quantity) {
      //     throw createError(
      //       `Cannot approve: available stock is insufficient. ` +
      //       `Available: ${available}, requested: ${tx.quantity}.`
      //     );
      //   }
      // }

      tx.status = decision === "approve" ? "approved" : "rejected";
      tx.rejectionReason = decision === "reject" ? reason : "";
      tx.reviewedBy = req.user._id;
      tx.reviewedAt = new Date();

      await tx.save({ session });

      responseTransaction = tx;
    });

    return res.json({
      message: `Entry ${responseTransaction.status}.`,
      transaction: responseTransaction
    });
  } catch (error) {
    console.error("Transaction review error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Unable to review transaction."
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

// ---------------- ADMIN ONLY: DELETE REVIEWED ENTRY ----------------

router.delete("/:id", adminOnly, async (req, res) => {
  let session;

  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid transaction ID."
      });
    }

    session = await mongoose.startSession();

    let deleted = false;

    await session.withTransaction(async () => {
      const tx = await Transaction.findById(id).session(session);

      if (!tx) {
        throw createError("Entry not found.", 404);
      }

      if (tx.status === "pending") {
        throw createError(
          "Pending entries cannot be deleted. Review them first.",
          409
        );
      }

      if (tx.batchId) {
        throw createError(
          "This entry belongs to an invoice. Delete the complete invoice instead.",
          409
        );
      }

      await lockItems([tx.item], session);

      if (tx.status === "approved") {
        const available = await getAvailableStock(tx.item, session);

        const resultingStock =
          tx.type === "RECEIVE"
            ? available - tx.quantity
            : available + tx.quantity;

        if (resultingStock < 0) {
          throw createError(
            `Cannot delete this RECEIVE entry. It would make stock negative. Current stock: ${available}.`,
            409
          );
        }
      }

      await Transaction.deleteOne(
        { _id: tx._id },
        { session }
      );

      deleted = true;
    });

    return res.json({
      message: deleted
        ? "Entry deleted successfully."
        : "Nothing deleted."
    });
  } catch (error) {
    console.error("Delete transaction error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Unable to delete entry."
    });
  } finally {
    if (session) await session.endSession();
  }
});

// ---------------- ADMIN ONLY: DELETE REVIEWED INVOICE ----------------

router.delete("/batch/:batchId", adminOnly, async (req, res) => {
  let session;

  try {
    const batchId = String(req.params.batchId || "");

    if (!batchId || batchId.length > 100) {
      return res.status(400).json({
        message: "Invalid invoice batch ID."
      });
    }

    session = await mongoose.startSession();

    let deletedCount = 0;

    await session.withTransaction(async () => {
      const rows = await Transaction.find({
        batchId
      }).session(session);

      if (!rows.length) {
        throw createError("Invoice not found.", 404);
      }

      if (rows.some(row => row.status === "pending")) {
        throw createError(
          "This invoice is pending. Review it before deletion.",
          409
        );
      }

      const itemIds = rows.map(row => row.item);
      await lockItems(itemIds, session);

      const approvedByItem = new Map();

      for (const row of rows) {
        if (row.status !== "approved") continue;

        const key = String(row.item);

        if (!approvedByItem.has(key)) {
          approvedByItem.set(key, {
            receive: 0,
            dispatch: 0
          });
        }

        const totals = approvedByItem.get(key);

        if (row.type === "RECEIVE") {
          totals.receive += row.quantity;
        }

        if (row.type === "DISPATCH") {
          totals.dispatch += row.quantity;
        }
      }

      for (const [itemId, removed] of approvedByItem) {
        const currentStock = await getAvailableStock(itemId, session);

        const resultingStock =
          currentStock - removed.receive + removed.dispatch;

        if (resultingStock < 0) {
          const item = await Item.findById(itemId).session(session);

          throw createError(
            `Cannot delete invoice. Stock would become negative for ` +
            `${item?.code || itemId}. Current: ${currentStock}, ` +
            `after deletion: ${resultingStock}.`,
            409
          );
        }
      }

      const result = await Transaction.deleteMany(
        { batchId },
        { session }
      );

      deletedCount = result.deletedCount;
    });

    return res.json({
      message:
        `Invoice deleted successfully. ${deletedCount} entries removed.`,
      deletedCount
    });
  } catch (error) {
    console.error("Delete invoice error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Unable to delete invoice."
    });
  } finally {
    if (session) await session.endSession();
  }
});

module.exports = router;

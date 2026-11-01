const router = require("express").Router();
const Transaction = require("../models/Transaction");
const Item = require("../models/Item");
const { auth, adminOnly } = require("../middleware/auth");
const upload = require("../middleware/upload");
router.use(auth);

router.get("/", async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { createdBy: req.user._id };
  const rows = await Transaction.find(filter).populate("item", "code name image")
    .populate("createdBy", "name username").populate("reviewedBy", "name").sort({ createdAt: -1 }).limit(500);
  res.json(rows);
});

router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { itemId, type, quantity, note } = req.body;
    if (!["RECEIVE", "DISPATCH"].includes(type)) return res.status(400).json({ message: "Invalid transaction type." });
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ message: "Quantity must be a positive whole number." });
    const item = await Item.findById(itemId);
    if (!item) return res.status(404).json({ message: "Item not found." });
    if (type === "DISPATCH") {
      const agg = await Transaction.aggregate([
        { $match: { item: item._id, status: "approved" } },
        { $group: { _id: "$type", qty: { $sum: "$quantity" } } }
      ]);
      const totals = { RECEIVE: 0, DISPATCH: 0 };
      agg.forEach(x => totals[x._id] = x.qty);
      if (totals.RECEIVE - totals.DISPATCH < qty)
        return res.status(400).json({ message: `Insufficient stock. Available: ${totals.RECEIVE - totals.DISPATCH}` });
    }
    const tx = await Transaction.create({
      item: item._id, type, quantity: qty, note: note || "",
      image: req.file ? "/uploads/" + req.file.filename : "",
      createdBy: req.user._id, status: "pending"
    });
    res.status(201).json({ message: "Entry sent to admin for approval.", transaction: tx });
  } catch (e) { res.status(400).json({ message: e.message || "Could not create entry." }); }
});

router.patch("/:id/review", adminOnly, async (req, res) => {
  const { decision, reason } = req.body;
  if (!["approve", "reject"].includes(decision)) return res.status(400).json({ message: "Invalid decision." });
  const tx = await Transaction.findById(req.params.id);
  if (!tx) return res.status(404).json({ message: "Transaction not found." });
  if (tx.status !== "pending") return res.status(409).json({ message: "This entry has already been reviewed." });
  if (decision === "approve" && tx.type === "DISPATCH") {
    const agg = await Transaction.aggregate([
      { $match: { item: tx.item, status: "approved" } },
      { $group: { _id: "$type", qty: { $sum: "$quantity" } } }
    ]);
    const totals = { RECEIVE: 0, DISPATCH: 0 };
    agg.forEach(x => totals[x._id] = x.qty);
    if (totals.RECEIVE - totals.DISPATCH < tx.quantity)
      return res.status(400).json({ message: "Cannot approve: available stock is now insufficient." });
  }
  tx.status = decision === "approve" ? "approved" : "rejected";
  tx.rejectionReason = decision === "reject" ? String(reason || "Rejected by admin").slice(0, 300) : "";
  tx.reviewedBy = req.user._id;
  tx.reviewedAt = new Date();
  await tx.save();
  res.json({ message: `Entry ${tx.status}.`, transaction: tx });
});
module.exports = router;

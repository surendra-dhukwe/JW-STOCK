const router = require("express").Router();
const Item = require("../models/Item");
const Transaction = require("../models/Transaction");
const { auth } = require("../middleware/auth");
const upload = require("../middleware/upload");
router.use(auth);

router.get("/", async (req, res) => {
  const items = await Item.find().populate("createdBy", "name").sort({ name: 1 }).lean();
  const totals = await Transaction.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: { item: "$item", type: "$type" }, qty: { $sum: "$quantity" } } }
  ]);
  const map = {};
  totals.forEach(t => {
    const id = String(t._id.item);
    map[id] ||= { receive: 0, dispatch: 0 };
    map[id][t._id.type === "RECEIVE" ? "receive" : "dispatch"] = t.qty;
  });
  res.json(items.map(i => ({ ...i,
    stock: (map[String(i._id)]?.receive || 0) - (map[String(i._id)]?.dispatch || 0),
    received: map[String(i._id)]?.receive || 0,
    dispatched: map[String(i._id)]?.dispatch || 0
  })));
});

// Any approved user can add an item. Item creation itself is immediate;
// stock quantities still require admin approval through the transaction workflow.
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const unit = String(req.body.unit || "").toUpperCase();
    if (!["PCS", "KG"].includes(unit))
      return res.status(400).json({ message: "Choose PCS or KG as the item's unit." });
    const item = await Item.create({
      code: req.body.code, name: req.body.name, unit,
      description: req.body.description || "",
      image: req.file ? "/uploads/" + req.file.filename : "",
      createdBy: req.user._id
    });
    res.status(201).json(item);
  } catch (e) {
    res.status(400).json({ message: e.code === 11000 ? "Item code already exists." : e.message });
  }
});
module.exports = router;

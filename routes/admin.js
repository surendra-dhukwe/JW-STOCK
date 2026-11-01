const router = require("express").Router();
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { auth, adminOnly } = require("../middleware/auth");
router.use(auth, adminOnly);

router.get("/users", async (req, res) => {
  const users = await User.find().select("-passwordHash").sort({ createdAt: -1 });
  res.json(users);
});
router.patch("/users/:id", async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status." });
  const user = await User.findById(req.params.id);
  if (!user || user.role === "admin") return res.status(404).json({ message: "User not found." });
  user.status = status; await user.save();
  res.json({ message: `User ${status}.` });
});
router.get("/summary", async (req, res) => {
  const [users, pendingUsers, pendingTransactions, transactions] = await Promise.all([
    User.countDocuments({ status: "approved", role: "user" }),
    User.countDocuments({ status: "pending" }),
    Transaction.countDocuments({ status: "pending" }),
    Transaction.countDocuments()
  ]);
  res.json({ users, pendingUsers, pendingTransactions, transactions });
});
module.exports = router;

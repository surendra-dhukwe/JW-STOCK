
const router = require("express").Router();

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { auth, adminOnly } = require("../middleware/auth");

router.use(auth, adminOnly);

// GET ALL USERS
router.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .lean();

    return res.json(users);
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ message: "Unable to load users." });
  }
});

// APPROVE / REJECT USER
router.patch("/users/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const user = await User.findById(req.params.id);

    if (!user || user.role === "admin") {
      return res.status(404).json({ message: "User not found." });
    }

    user.status = status;
    await user.save();

    return res.json({ message: `User ${status}.` });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ message: "Unable to update user." });
  }
});

// DASHBOARD SUMMARY
router.get("/summary", async (req, res) => {
  try {
    const [users, pendingUsers, pendingTransactions, transactions, totals] =
      await Promise.all([
        User.countDocuments({ status: "approved", role: "user" }),
        User.countDocuments({ status: "pending" }),
        Transaction.countDocuments({ status: "pending" }),
        Transaction.countDocuments(),

        Transaction.aggregate([
          { $match: { status: "approved" } },
          {
            $group: {
              _id: "$type",
              quantity: { $sum: "$quantity" }
            }
          }
        ])
      ]);

    const received =
      totals.find(row => row._id === "RECEIVE")?.quantity || 0;

    const dispatched =
      totals.find(row => row._id === "DISPATCH")?.quantity || 0;

    return res.json({
      users,
      pendingUsers,
      pendingTransactions,
      transactions,
      received,
      dispatched,
      netStock: received - dispatched
    });
  } catch (error) {
    console.error("Admin summary error:", error);
    return res.status(500).json({ message: "Unable to load summary." });
  }
});

// PENDING TRANSACTIONS ONLY
router.get("/pending-transactions", async (req, res) => {
  try {
    const rows = await Transaction.find({ status: "pending" })
      .populate("item", "code name image unit")
      .populate("createdBy", "name username")
      .sort({ createdAt: -1 })
      .lean();

    return res.json(rows);
  } catch (error) {
    console.error("Pending transactions error:", error);
    return res.status(500).json({
      message: "Unable to load pending transactions."
    });
  }
});

module.exports = router;

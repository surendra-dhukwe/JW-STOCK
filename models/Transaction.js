const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
  type: { type: String, enum: ["RECEIVE", "DISPATCH"], required: true },
  quantity: { type: Number, required: true, min: 1 },
  note: { type: String, default: "" },
  image: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: "" }
}, { timestamps: true });
module.exports = mongoose.model("Transaction", schema);

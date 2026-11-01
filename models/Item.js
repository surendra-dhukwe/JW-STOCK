const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  unit: { type: String, enum: ["PCS", "KG"], required: true, default: "PCS" },
  description: { type: String, default: "" },
  image: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
module.exports = mongoose.model("Item", schema);

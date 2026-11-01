const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 70 },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" }
}, { timestamps: true });
module.exports = mongoose.model("User", schema);

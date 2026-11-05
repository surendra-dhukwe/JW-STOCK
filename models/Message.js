
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    text: {
      type: String,
      default: "",
      maxlength: 3000,
      trim: true
    },
    image: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

// Chat messages latest-first query ke liye index
schema.index({ createdAt: -1 });

// Model already registered ho to wahi reuse karo
module.exports =
  mongoose.models.Message ||
  mongoose.model("Message", schema);

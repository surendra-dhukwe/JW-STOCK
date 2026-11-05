
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 50
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },

    unit: {
      type: String,
      enum: ["PCS", "KG"],
      required: true,
      default: "PCS"
    },

    description: {
      type: String,
      default: "",
      maxlength: 2000
    },

    image: {
      type: String,
      default: ""
    },

    category: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100
    },

    brand: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100
    },

    specifications: {
      type: String,
      default: "",
      maxlength: 2000
    },

    location: {
      type: String,
      default: "",
      trim: true,
      maxlength: 150
    },

    minimumStock: {
      type: Number,
      default: 0,
      min: 0
    },

    // Used to coordinate concurrent stock approvals
    stockVersion: {
      type: Number,
      default: 0,
      min: 0
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    lastEditedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

schema.index({ name: "text", code: "text" });
schema.index({ name: 1 });
schema.index({ category: 1 });

module.exports = mongoose.model("Item", schema);

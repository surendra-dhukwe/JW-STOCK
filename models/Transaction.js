
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
      index: true
    },

    type: {
      type: String,
      enum: ["RECEIVE", "DISPATCH"],
      required: true
    },

    qnt: {
      type: Number,
      required: true,
      min: 1
    },

    bags: {
      type: Number,
      default: 1,
      min: 1
    },

    bagPerKg: {
      type: Number,
      default: 0,
      min: 0
    },

    totalKg: {
      type: Number,
      default: 0,
      min: 0
    },

    totalQuantity: {
      type: Number,
      required: true,
      min: 1
    },

    quantity: {
      type: Number,
      required: true,
      min: 1
    },

    manualTotalQuantity: {
      type: Boolean,
      default: false
    },

    manualTotalKg: {
      type: Boolean,
      default: false
    },

    batchId: {
      type: String,
      default: "",
      index: true
    },

    invoiceNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80
    },

    invoiceDate: {
      type: Date,
      default: null
    },

    note: {
      type: String,
      default: "",
      maxlength: 1000
    },

    image: {
      type: String,
      default: ""
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    reviewedAt: {
      type: Date,
      default: null
    },

    rejectionReason: {
      type: String,
      default: "",
      maxlength: 300
    }
  },
  {
    timestamps: true
  }
);

schema.index({ batchId: 1, status: 1 });
schema.index({ invoiceNumber: 1, createdBy: 1 });
schema.index({ createdAt: -1 });
schema.index({ createdBy: 1, createdAt: -1 });

module.exports =
  mongoose.models.Transaction ||
  mongoose.model("Transaction", schema);

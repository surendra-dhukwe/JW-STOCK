
const mongoose = require("mongoose");

const draftItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      default: null
    },

    code: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
      maxlength: 50
    },

    name: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200
    },

    qnt: {
      type: Number,
      default: null,
      min: 0
    },

    bags: {
      type: Number,
      default: null,
      min: 0
    },

    bagPerKg: {
      type: Number,
      default: null,
      min: 0
    },

    totalQuantity: {
      type: Number,
      default: null,
      min: 0
    },

    totalKg: {
      type: Number,
      default: null,
      min: 0
    },

    // Track whether totals were entered manually.
    manualTotalQuantity: {
      type: Boolean,
      default: false
    },

    manualTotalKg: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: true
  }
);

const invoiceDraftSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    type: {
      type: String,
      enum: ["RECEIVE", "DISPATCH"],
      default: "RECEIVE"
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

    items: {
      type: [draftItemSchema],
      default: []
    },

    lastSavedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Fast retrieval of a user's latest drafts.
invoiceDraftSchema.index({
  createdBy: 1,
  updatedAt: -1
});

module.exports =
  mongoose.models.InvoiceDraft ||
  mongoose.model("InvoiceDraft", invoiceDraftSchema);


const mongoose = require("mongoose");

const schema = new mongoose.Schema({
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

}, {
  timestamps: true
});

module.exports = mongoose.model("Message", schema);

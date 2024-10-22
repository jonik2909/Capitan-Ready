const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true },
    groupName: String,
    groupType: String,
    botRole: String,
  },
  { timestamps: true }
);

const Group = mongoose.model("Group", groupSchema);

module.exports = Group;

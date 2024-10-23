const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true },
    scheduleTime: { type: String, required: true },
  },
  { timestamps: true }
);

ScheduleSchema.index({ groupId: 1, scheduleTime: 1 }, { unique: true });

const Schedule = mongoose.model("Schedule", ScheduleSchema);

module.exports = Schedule;

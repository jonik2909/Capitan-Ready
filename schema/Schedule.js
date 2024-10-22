const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true },
    message: String,
    scheduleTime: { type: String, required: true },
    jobId: String,
  },
  { timestamps: true }
);

const Schedule = mongoose.model("Schedule", ScheduleSchema);

module.exports = Schedule;

const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true },
    scheduleTimes: [
      {
        day: {
          type: String,
          enum: ["0", "1", "2", "3", "4", "5", "6"], // Sunday = 0, Monday = 1, etc.
          required: true,
        },
        time: { type: String, required: true }, // Format: HH:MM
      },
    ],
  },
  { timestamps: true }
);

const Schedule = mongoose.model("Schedule", ScheduleSchema);

module.exports = Schedule;

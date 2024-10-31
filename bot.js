const dotenv = require("dotenv");
const { Bot, InlineKeyboard } = require("grammy");
const { session } = require("grammy");
const cron = require("node-cron");
const Group = require("./schema/Group");
const Schedule = require("./schema/Schedule");

// Load environment variables
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});

// Constants
const ADMIN_ID = 399545508;
const BOT_COMMANDS = { START: "start" };
const CALLBACK_ACTIONS = {
  MANAGE_SCHEDULE: "manage_schedule",
  ADD_SCHEDULE: "add_schedule",
  REMOVE_SCHEDULE: "remove_schedule",
  SELECT_DAY: "select_day",
  CONFIRM_DAY_TIME: "confirm_day_time",
  FINALIZE_SCHEDULE: "finalize_schedule",
  CONFIRM_FINALIZE: "confirm_finalize",
  CONFIRM_REMOVE_GROUP_SCHEDULE: "confirm_remove_group_schedule",
};
const DAYS_OF_WEEK = {
  MONDAY: "1",
  TUESDAY: "2",
  WEDNESDAY: "3",
  THURSDAY: "4",
  FRIDAY: "5",
  SATURDAY: "6",
  SUNDAY: "0",
};

// Utility functions
const isValidTimeFormat = (time) =>
  /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);

const createCronJob = (dayTime, groupId, ctx) => {
  const [hours, minutes] = dayTime.time.split(":");
  const cronPattern = `${minutes} ${hours} * * ${dayTime.day}`;

  return cron.schedule(
    cronPattern,
    async () => {
      try {
        const group = await Group.findOne({ telegramId: groupId });
        if (group) {
          await ctx.api.sendPoll(
            groupId,
            "Assalomu alaykum, Zoom darsligiga tayyormisiz?",
            ["ha", "yo'q"],
            {
              is_anonymous: false,
              allows_multiple_answers: false,
            }
          );
        }
      } catch (error) {
        console.error(`Error sending poll to group ${groupId}:`, error);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Seoul", // Add this line to set the timezone to Seoul
    }
  );
};

const bot = new Bot(process.env.TOKEN);
const jobMap = new Map();

// Middleware
bot.use(
  session({
    initial: () => ({
      currentAction: null,
      scheduleSetup: {
        groupId: null,
        daysAndTimes: [],
      },
    }),
  })
);

const adminMiddleware = async (ctx, next) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.reply("You are not authorized to use this bot.");
    return;
  }
  return next();
};

// Command handlers
bot.command(BOT_COMMANDS.START, adminMiddleware, async (ctx) => {
  await showGroupsMenu(ctx);
});

bot.on("my_chat_member", async (ctx) => {
  const newStatus = ctx.myChatMember.new_chat_member.status;
  const oldStatus = ctx.myChatMember.old_chat_member.status;

  // Check if this is a group chat
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    // Bot was added to group or status changed to administrator
    if (newStatus === "administrator" || newStatus === "member") {
      const chat = ctx.chat;
      const groupData = {
        telegramId: chat.id.toString(),
        groupName: chat.title || "Unnamed Group",
        groupType: chat.type,
        botRole: newStatus,
      };

      try {
        const group = await Group.findOneAndUpdate(
          { telegramId: groupData.telegramId },
          groupData,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log("Group data saved:", group);
      } catch (error) {
        console.error("Error saving group data:", error);
      }
    }
    // Bot was removed from group or left
    else if (
      (oldStatus === "member" || oldStatus === "administrator") &&
      (newStatus === "left" || newStatus === "kicked")
    ) {
      await cleanupGroupData(ctx.chat.id.toString());
    }
  }
});

async function showGroupSchedule(ctx, groupId) {
  try {
    const schedule = await Schedule.findOne({ groupId });
    const group = await Group.findOne({ telegramId: groupId });
    const groupName = group ? group.groupName : groupId;

    if (schedule && schedule.scheduleTimes.length > 0) {
      const scheduleList = schedule.scheduleTimes
        .map(({ day, time }) => {
          const dayName = Object.keys(DAYS_OF_WEEK).find(
            (key) => DAYS_OF_WEEK[key] === day
          );
          return `- ${dayName}: ${time}`;
        })
        .join("\n");

      const keyboard = new InlineKeyboard().text(
        "Remove Schedule",
        `${CALLBACK_ACTIONS.REMOVE_SCHEDULE}:${groupId}`
      );

      await ctx.reply(
        `📅 Current schedule for ${groupName.toUpperCase()}:\n\n${scheduleList}`,
        { reply_markup: keyboard }
      );
    } else {
      const keyboard = new InlineKeyboard().text(
        "Add Schedule",
        `${CALLBACK_ACTIONS.ADD_SCHEDULE}:${groupId}`
      );

      await ctx.reply(
        `No schedule found for ${groupName.toUpperCase()}. Would you like to add one?`,
        { reply_markup: keyboard }
      );
    }
  } catch (error) {
    console.error("Error showing group schedule:", error);
    await ctx.reply("Error retrieving schedule. Please try again.");
  }
}

bot.on("callback_query:data", adminMiddleware, async (ctx) => {
  try {
    const [action, data] = ctx.callbackQuery.data.split(":");
    await ctx.deleteMessage();

    switch (action) {
      case CALLBACK_ACTIONS.REMOVE_SCHEDULE:
        await confirmGroupScheduleRemoval(ctx, data);
        break;

      case CALLBACK_ACTIONS.CONFIRM_REMOVE_GROUP_SCHEDULE:
        if (data.startsWith("yes-")) {
          const groupId = data.split("-")[1];
          await removeGroupSchedule(ctx, `-${groupId}`);
        } else {
          await ctx.reply("Schedule removal canceled.");
          await showGroupsMenu(ctx);
        }
        break;

      case CALLBACK_ACTIONS.CONFIRM_FINALIZE:
        if (data === "yes") {
          await saveAndSchedule(ctx);
        } else {
          await ctx.reply("Schedule creation canceled.");
          ctx.session.scheduleSetup = { groupId: null, daysAndTimes: [] };
          await showGroupsMenu(ctx);
        }
        break;

      case CALLBACK_ACTIONS.MANAGE_SCHEDULE:
        await showGroupSchedule(ctx, data);
        break;

      case CALLBACK_ACTIONS.ADD_SCHEDULE:
        const existingSchedule = await Schedule.findOne({ groupId: data });
        if (existingSchedule) {
          await ctx.reply("This group already has a schedule.");
          await showGroupSchedule(ctx, data);
        } else {
          ctx.session.scheduleSetup.groupId = data;
          await showDaySelectionMenu(ctx);
          ctx.session.currentAction = "select_day";
        }
        break;

      case CALLBACK_ACTIONS.SELECT_DAY:
        ctx.session.scheduleSetup.selectedDay = data;
        await ctx.reply("Please enter the time for this day (HH:MM):");
        ctx.session.currentAction = "enter_time";
        break;

      case CALLBACK_ACTIONS.CONFIRM_DAY_TIME:
        await showDaySelectionMenu(ctx);
        break;

      case CALLBACK_ACTIONS.FINALIZE_SCHEDULE:
        await finalizeSchedule(ctx);
        break;
    }
  } catch (error) {
    console.error("Error handling callback query:", error);
    await ctx.reply("An error occurred. Please try again.");
  }
});

bot.on("message", async (ctx) => {
  const action = ctx.session.currentAction;
  if (action === "enter_time") {
    const time = ctx.message.text.trim();
    if (!isValidTimeFormat(time)) {
      await ctx.reply(
        "Invalid time format. Please use HH:MM format (e.g., 09:30)."
      );
      return;
    }

    ctx.session.scheduleSetup.daysAndTimes.push({
      day: ctx.session.scheduleSetup.selectedDay,
      time,
    });

    await ctx.reply("Day and time added!");
    await showDaySelectionMenu(ctx);
    ctx.session.currentAction = null;
  }
});

// Helper functions
async function confirmGroupScheduleRemoval(ctx, groupId) {
  try {
    const schedule = await Schedule.findOne({ groupId });

    if (!schedule) {
      await ctx.reply("No schedules found for this group.");
      return await showGroupsMenu(ctx);
    }

    const group = await Group.findOne({ telegramId: groupId });
    const groupName = group ? group.groupName : groupId;

    const keyboard = new InlineKeyboard()
      .text(
        "Confirm ✅",
        `${
          CALLBACK_ACTIONS.CONFIRM_REMOVE_GROUP_SCHEDULE
        }:yes-${groupId.replace("-", "")}`
      )
      .text(
        "Cancel ❌",
        `${CALLBACK_ACTIONS.CONFIRM_REMOVE_GROUP_SCHEDULE}:no`
      );

    await ctx.reply(
      `Are you sure you want to remove ALL schedules for group ${groupName.toUpperCase()}?`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error("Error confirming group schedule removal:", error);
    await ctx.reply("Error preparing schedule removal. Please try again.");
  }
}

async function removeGroupSchedule(ctx, groupId) {
  try {
    // Get the schedule to find all associated cron jobs
    const schedule = await Schedule.findOne({ groupId: groupId });

    if (schedule) {
      // Stop all cron jobs for this group
      schedule.scheduleTimes.forEach(({ day }) => {
        const jobKey = `${groupId}-${day}`;
        const job = jobMap.get(jobKey);
        if (job) {
          job.stop();
          jobMap.delete(jobKey);
        }
      });

      // Delete the schedule document
      await Schedule.deleteOne({ groupId });

      await ctx.reply(
        "All schedules for this group have been successfully removed!"
      );
    } else {
      await ctx.reply("No schedules found for this group.");
    }

    // Show the groups menu again
    await showGroupsMenu(ctx);
  } catch (error) {
    console.error("Error removing group schedule:", error);
    await ctx.reply("Error removing schedules. Please try again.");
    await showGroupsMenu(ctx);
  }
}

async function showDaySelectionMenu(ctx) {
  const keyboard = new InlineKeyboard();
  const selectedDays = ctx.session.scheduleSetup.daysAndTimes.map(
    (dt) => dt.day
  );

  Object.entries(DAYS_OF_WEEK).forEach(([day, value], index) => {
    const isSelected = selectedDays.includes(value);
    const buttonText = `${day} ${isSelected ? "✅" : ""}`;
    keyboard.text(buttonText, `${CALLBACK_ACTIONS.SELECT_DAY}:${value}`);
    if (index % 2 === 1) keyboard.row();
  });

  if (ctx.session.scheduleSetup.daysAndTimes.length > 0) {
    keyboard.text(
      "Finalize Schedule ✅",
      `${CALLBACK_ACTIONS.FINALIZE_SCHEDULE}:done`
    );
  }

  await ctx.reply("Select a day to set time (click to toggle):", {
    reply_markup: keyboard,
  });
}

async function finalizeSchedule(ctx) {
  const { groupId, daysAndTimes } = ctx.session.scheduleSetup;

  if (daysAndTimes.length === 0) {
    return await ctx.reply(
      "No days and times have been selected. Please add at least one day and time."
    );
  }

  // Build summary message
  const summary = daysAndTimes
    .map(
      ({ day, time }) =>
        `- Day: ${Object.keys(DAYS_OF_WEEK).find(
          (key) => DAYS_OF_WEEK[key] === day
        )}, Time: ${time}`
    )
    .join("\n");

  const group = await Group.findOne({ telegramId: groupId });

  const confirmationMessage = `Please confirm the following schedule for group ${group?.groupName.toUpperCase()}:\n${summary}`;

  const keyboard = new InlineKeyboard()
    .text("Confirm ✅", `${CALLBACK_ACTIONS.CONFIRM_FINALIZE}:yes`)
    .text("Cancel ❌", `${CALLBACK_ACTIONS.CONFIRM_FINALIZE}:no`);

  await ctx.reply(confirmationMessage, { reply_markup: keyboard });
}

async function showGroupsMenu(ctx) {
  const groups = await Group.find({});
  if (!groups.length) return await ctx.reply("No groups found.");

  const keyboard = new InlineKeyboard();
  groups.forEach((group) => {
    keyboard.text(
      group.groupName.toUpperCase(),
      `${CALLBACK_ACTIONS.MANAGE_SCHEDULE}:${group.telegramId}`
    );
    keyboard.row();
  });

  await ctx.reply("Select a group to manage schedules:", {
    reply_markup: keyboard,
  });
}

async function saveAndSchedule(ctx) {
  const { groupId, daysAndTimes } = ctx.session.scheduleSetup;

  try {
    const schedule = new Schedule({ groupId, scheduleTimes: daysAndTimes });
    await schedule.save();

    // Create cron jobs
    daysAndTimes.forEach((dayTime) => {
      const job = createCronJob(dayTime, groupId, ctx);
      jobMap.set(`${groupId}-${dayTime.day}`, job);
    });

    await ctx.reply("Schedule successfully confirmed and created!");
    ctx.session.scheduleSetup = { groupId: null, daysAndTimes: [] };
    await showGroupsMenu(ctx);
  } catch (error) {
    console.error("Error finalizing schedule:", error);
    await ctx.reply("Error saving schedule. Please try again.");
    await showGroupsMenu(ctx);
  }
}

async function cleanupGroupData(groupId) {
  try {
    // Stop all cron jobs for this group
    const schedule = await Schedule.findOne({ groupId });
    if (schedule) {
      schedule.scheduleTimes.forEach(({ day }) => {
        const jobKey = `${groupId}-${day}`;
        const job = jobMap.get(jobKey);
        if (job) {
          job.stop();
          jobMap.delete(jobKey);
        }
      });
    }

    // Delete schedule and group data from database
    await Promise.all([
      Schedule.deleteOne({ groupId }),
      Group.deleteOne({ telegramId: groupId }),
    ]);

    console.log(`Cleaned up data for group ${groupId}`);
  } catch (error) {
    console.error(`Error cleaning up group data for ${groupId}:`, error);
  }
}

bot.catch((err) => console.error("Error in bot:", err));

module.exports = bot;

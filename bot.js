const dotenv = require("dotenv");
dotenv.config();
const { Bot } = require("grammy");
const Group = require("./schema/Group");
const cron = require("node-cron");
const Schedule = require("./schema/Schedule");

const bot = new Bot(process.env.TOKEN);

// Create a Map to store cron jobs
const jobMap = new Map();

const ADMIN_ID = 399545508; // Replace with your admin ID

// Handle the bot start command
bot.command("start", (ctx) => {
  ctx.reply("Hello!");
});

bot.on("my_chat_member", async (ctx) => {
  const newStatus = ctx.myChatMember.new_chat_member.status;

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
});

// Middleware to check admin privileges
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

// Command to schedule messages
bot.command("schedule", async (ctx) => {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply("You do not have permission to use this command.");
    }

    const [groupId, time, ...messageParts] = ctx.message.text
      .split(" ")
      .slice(1);
    const message = messageParts.join(" ");

    const scheduleData = new Schedule({
      groupId,
      message,
      scheduleTime: time,
    });

    await scheduleData.save();
    ctx.reply(`Schedule set for group ${groupId} at ${time}`);

    // Set cron job for the scheduled time
    const job = cron.schedule(
      `${time.split(":")[1]} ${time.split(":")[0]} * * *`,
      async () => {
        const group = await Group.findOne({ telegramId: groupId });
        await bot.api.sendMessage(groupId, message);
        console.log(`Message sent to group ${groupId}: ${message}`);
      }
    );

    // Store the job ID in the scheduleData and jobMap
    scheduleData.jobId = job.id; // Assign job ID to scheduleData
    await scheduleData.save(); // Save the updated schedule with job ID
    jobMap.set(job.id, job); // Store the job in the jobMap
  } catch (error) {
    ctx.reply(`Something went wrong!`);
  }
});

// Command to remove a scheduled message
bot.command("remove_schedule", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("You do not have permission to use this command.");
  }

  const [groupId] = ctx.message.text.split(" ").slice(1);

  if (!groupId) {
    return ctx.reply("Usage: /remove_schedule <groupId>");
  }

  try {
    const schedule = await Schedule.findOne({ groupId });

    if (schedule) {
      // Stop the corresponding cron job if it exists
      const job = jobMap.get(schedule.jobId);
      if (job) {
        job.stop();
        jobMap.delete(schedule.jobId); // Remove from the map
        console.log(`Stopped job for group ${groupId}.`);
      }

      await Schedule.deleteOne({ groupId });
      ctx.reply(`Removed schedule for group ${groupId}.`);
      console.log(`Removed schedule for group ${groupId}.`);
    } else {
      ctx.reply(`No schedule found for group ${groupId}.`);
    }
  } catch (error) {
    console.error("Error removing schedule:", error);
    ctx.reply("Error removing schedule. Please try again.");
  }
});

bot.catch((err) => {
  console.error("Error in bot:", err);
});

module.exports = bot;

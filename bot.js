const dotenv = require("dotenv");
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});
const { Bot, InlineKeyboard } = require("grammy");
const { session } = require("grammy");

const Group = require("./schema/Group");
const cron = require("node-cron");
const Schedule = require("./schema/Schedule");

const bot = new Bot(process.env.TOKEN);
bot.use(
  session({
    initial: () => ({ currentAction: null }),
  })
);

const adminMiddleware = (ctx, next) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("You are not authorized to use this bot.");
  }
  return next();
};

const jobMap = new Map();

const ADMIN_ID = 399545508;
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

bot.command("start", adminMiddleware, async (ctx) => {
  try {
    const groups = await Group.find({});

    if (groups.length === 0) {
      return ctx.reply("No groups found.");
    }

    const keyboard = new InlineKeyboard();

    groups.forEach((group) => {
      keyboard.text(
        `${group.groupName.toUpperCase()}`,
        `manage_schedule:${group.telegramId}`
      );
    });

    await ctx.reply("Select a group to manage schedules:", {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error retrieving groups:", error);
    ctx.reply("Error retrieving groups. Please try again.");
  }
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

bot.on("callback_query:data", adminMiddleware, async (ctx) => {
  const [action, groupId] = ctx.callbackQuery.data.split(":");

  if (action === "manage_schedule") {
    const keyboard = new InlineKeyboard()
      .text("Add Schedule", `add_schedule:${groupId}`)
      .text("Remove Schedule", `remove_schedule:${groupId}`);

    await ctx.reply("Choose an action:", {
      reply_markup: keyboard,
    });
  }

  if (action === "add_schedule") {
    await ctx.reply("Please enter time (HH:MM):");
    ctx.session.currentAction = { type: "add", groupId };
  }
  if (action === "remove_schedule") {
    try {
      const schedule = await Schedule.findOne({ groupId });

      if (schedule) {
        const job = jobMap.get(schedule.groupId);
        if (job) {
          job.stop();
          jobMap.delete(schedule.groupId);
          console.log(`Stopped job for group ${groupId}.`);
        }

        await Schedule.deleteOne({ groupId });
        ctx.reply(`Removed schedule.`);
      } else {
        ctx.reply(`No schedule found for this group.`);
      }
      return showGroupsMenu(ctx);
    } catch (error) {
      console.error("Error removing schedule:", error);
      ctx.reply("Error removing schedule. Please try again.");
    }
  }
});

bot.on("message", async (ctx) => {
  try {
    const action = ctx.session.currentAction;

    if (!action?.type) {
      ctx.reply(`Damingizni oling iltimos 😂️️`);
    }

    if (action && action.type === "add") {
      const { groupId } = action;
      const [time] = ctx.message.text.split(" ").slice(0);

      const scheduleData = new Schedule({
        groupId,
        scheduleTime: time,
      });

      const group = await Group.findOne({ telegramId: groupId });
      await scheduleData.save();
      ctx.reply(`Schedule set for group ${group?.groupName} at ${time}`);

      console.log("time.split", time.split(":"));

      const job = cron.schedule(
        `${time.split(":")[1]} ${time.split(":")[0]} * * *`,
        async () => {
          const group = await Group.findOne({ telegramId: groupId });
          if (group) {
            const question = "Assalomu alaykum Zoom darsligiga tayyormisiz? 😁";
            const options = ["Ha", "Yo'q"];

            await ctx.api.sendPoll(groupId, question, options, {
              is_anonymous: false,
              allows_multiple_answers: false,
            });
          }
        }
      );

      jobMap.set(groupId, job);
      ctx.session.currentAction = null;

      return showGroupsMenu(ctx);
    }
  } catch (error) {
    console.log("Error, botOnMessage:", error);
    ctx.reply(`Something went wrong!`);
  }
});

bot.catch((err) => {
  console.error("Error in bot:", err);
});

const showGroupsMenu = async (ctx) => {
  try {
    const groups = await Group.find({});

    if (groups.length === 0) {
      return ctx.reply("No groups found.");
    }

    const keyboard = new InlineKeyboard();
    groups.forEach((group) => {
      keyboard.text(
        `${group.groupName.toUpperCase()}`,
        `manage_schedule:${group.telegramId}`
      );
    });

    await ctx.reply("Select a group to manage schedules:", {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error retrieving groups:", error);
    ctx.reply("Error retrieving groups. Please try again.");
  }
};

module.exports = bot;

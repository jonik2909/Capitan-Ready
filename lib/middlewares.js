const User = require("../schema/user");

async function userExistsMiddleware(ctx, next) {
  console.log(" == userExistsMiddleware == ");
  if (!ctx.from) {
    return next();
  }

  if (ctx.message && ctx.message.contact) {
    return next();
  }

  const userId = ctx.from.id;
  let user = await User.findOne({ telegramId: userId });

  if (!user) {
    await ctx.reply("Please share your phone number to continue:", {
      reply_markup: {
        keyboard: [[{ text: "Share Phone Number", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else {
    ctx.user = user;
    await next();
  }
}

module.exports = { userExistsMiddleware };

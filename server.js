const dotenv = require("dotenv").config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});
const mongoose = require("mongoose");
const bot = require("./bot");

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log(
      "Connected to MongoDB successfully",
      process.env.NODE_ENV ? "production" : "develop"
    );
    bot.start();
  })
  .catch((err) => console.log("MongoDB is mongoose connect not found"));

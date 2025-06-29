import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  REST,
  Routes,
  PermissionsBitField,
  ActivityType,
} from "discord.js";
import fetch from "node-fetch";
import fs from "fs";

const DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN";
const OPENROUTER_API_KEY = "YOUR_OPENROUTER_API_KEY";
const CLIENT_ID = "YOUR_CLIENT_ID";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const userMemory = new Map();
let activatedChannels = new Set();
const ACTIVATE_FILE = "./activatedChannels.json";

function loadActivatedChannels() {
  if (fs.existsSync(ACTIVATE_FILE)) {
    const data = JSON.parse(fs.readFileSync(ACTIVATE_FILE));
    activatedChannels = new Set(data);
  }
}

function saveActivatedChannels() {
  fs.writeFileSync(ACTIVATE_FILE, JSON.stringify([...activatedChannels]));
}

const statuses = [
  "{Your bot status 1}",
  "{Your bot status 2}",
  "{Your bot status 3}",
  "{Your bot status 4}",
];

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadActivatedChannels();
  let index = 0;
  setInterval(() => {
    client.user.setActivity(`${statuses[index]}`, {
      type: ActivityType.Playing,
    });
    index = (index + 1) % statuses.length;
  }, 60000);
});

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [
        { name: "activate", description: "Enable full responses in this channel" },
        { name: "deactivate", description: "Disable full responses in this channel" },
        { name: "reset", description: "Reset your memory with the bot" },
        { name: "help", description: "Get help and support info" },
        { name: "coinflip", description: "Flip a coin" },
        {
          name: "avatar",
          description: "Get a user's avatar",
          options: [
            {
              name: "user",
              description: "Select a user",
              type: 6,
              required: true,
            },
          ],
        },
        {
          name: "say",
          description: "Bot sends your message",
          options: [
            {
              name: "message",
              description: "Message content",
              type: 3,
              required: true,
            },
          ],
        },
      ],
    });
    console.log("Commands registered.");
  } catch (err) {
    console.error("Command registration failed:", err);
  }
})();

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName, channel, member, user, options } = interaction;
  const isDM = channel.type === ChannelType.DM;

  if (isDM && ["activate", "deactivate"].includes(commandName)) {
    return interaction.reply({
      content: "This command only works in servers.",
      ephemeral: true,
    });
  }

  if (["activate", "deactivate", "say"].includes(commandName) && !isDM) {
    const isAdmin = member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    const isMod = member?.permissions?.has(PermissionsBitField.Flags.ManageMessages);

    if (["activate", "deactivate"].includes(commandName) && !isAdmin) {
      return interaction.reply({
        content: "Only administrators can use this command.",
        ephemeral: true,
      });
    }

    if (commandName === "say" && !isMod) {
      return interaction.reply({
        content: "Only moderators can use this command.",
        ephemeral: true,
      });
    }
  }

  if (commandName === "activate") {
    activatedChannels.add(channel.id);
    saveActivatedChannels();
    return interaction.reply({ content: "Bot activated in this channel." });
  }

  if (commandName === "deactivate") {
    activatedChannels.delete(channel.id);
    saveActivatedChannels();
    return interaction.reply({ content: "Bot deactivated in this channel." });
  }

  if (commandName === "reset") {
    userMemory.delete(user.id);
    return interaction.reply({ content: "Memory reset successfully.", ephemeral: true });
  }

  if (commandName === "help") {
    return interaction.reply({
      content:
        "This is a friendly AI chatbot.\nJoin our support server or add your own OpenRouter key.\n\nThis message is only visible to you.",
      ephemeral: true,
    });
  }

  if (commandName === "coinflip") {
    const result = Math.random() < 0.5 ? "Heads" : "Tails";
    return interaction.reply({ content: `The coin landed on ${result}.` });
  }

  if (commandName === "avatar") {
    const targetUser = options.getUser("user");
    const avatarUrl = targetUser.displayAvatarURL({ dynamic: true, size: 512 });
    return interaction.reply({
      embeds: [
        {
          title: `${targetUser.username}'s Avatar`,
          image: { url: avatarUrl },
          color: 0x00ff00,
        },
      ],
    });
  }

  if (commandName === "say") {
    const messageContent = options.getString("message");
    return interaction.reply({ content: `${messageContent}` });
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const isDM = message.channel.type === ChannelType.DM;
  const channelId = message.channel.id;
  let shouldRespond = isDM;

  if (!isDM) {
    const mentioned = message.mentions.has(client.user);
    let isReplyToBot = false;
    if (message.reference) {
      try {
        const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
        isReplyToBot = repliedMsg.author.id === client.user.id;
      } catch {}
    }
    shouldRespond = activatedChannels.has(channelId) || mentioned || isReplyToBot;
  }

  if (!shouldRespond) return;
  await message.channel.sendTyping();

  const userContent = isDM
    ? message.content.trim()
    : message.cleanContent.replace(`<@${client.user.id}>`, "").trim();
  if (!userContent) return;

  const prompt = `{Your Bot Backstory}`;

  const userId = message.author.id;
  const memory = userMemory.get(userId) || [];
  memory.push({ role: "user", content: userContent });

  const messages = [{ role: "system", content: prompt }, ...memory.slice(-10)];

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat:free",
        messages,
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (reply) {
      memory.push({ role: "assistant", content: reply });
      userMemory.set(userId, memory.slice(-10));
      message.reply(reply);
    } else {
      message.reply("No response generated.");
    }
  } catch (error) {
    console.error("OpenRouter error:", error);
    message.reply("Error talking to AI.");
  }
});

client.login(DISCORD_BOT_TOKEN);

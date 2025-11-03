// 🎁 The Candy Heist — discord.js v14

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Routes,
  REST,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- ENV SETUP ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;

// --- FILE PATHS ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.json");
const BANTER_PATH = path.join(__dirname, "banter.json");

// --- INIT FILES ---
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, banter_state: {} }, null, 2));
const banter = JSON.parse(fs.readFileSync(BANTER_PATH, "utf-8"));

// --- DB HELPERS ---
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function getUser(id) {
  const data = readDB();
  if (!data.users[id]) data.users[id] = { candy: 0, lockedUntil: null, nudgeOptOut: false };
  writeDB(data);
  return readDB().users[id];
}
function setUser(id, payload) {
  const data = readDB();
  data.users[id] = { ...(data.users[id] || {}), ...payload };
  writeDB(data);
}
function addCandy(id, n) {
  const u = getUser(id);
  const newAmt = Math.max(0, (u.candy || 0) + n);
  setUser(id, { candy: newAmt });
}
function isLocked(id) {
  const u = getUser(id);
  return u.lockedUntil && new Date(u.lockedUntil) > new Date();
}

// --- BANTER ROTATION ---
function getBanter(cat) {
  const data = readDB();
  const full = banter[cat] || ["[no banter]"];
  let remain = data.banter_state[cat];
  if (!remain || remain.length === 0) {
    remain = [...full].sort(() => Math.random() - 0.5);
  }
  const line = remain.shift();
  data.banter_state[cat] = remain;
  writeDB(data);
  return line;
}

// --- DISCORD CLIENT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// --- /xmas panel ---
async function sendXmasPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🎁 The Candy Heist")
    .setDescription("Collect, gift, and steal Candy Canes. Use the buttons below.")
    .setColor(0xE23C3B);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("gift").setLabel("Gift").setEmoji("🎁").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("heist").setLabel("Heist").setEmoji("💀").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("snowball").setLabel("Snowball").setEmoji("❄️").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lock").setLabel("Lock Stocking").setEmoji("🔒").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("leaderboard").setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Primary)
  );
  await interaction.reply({ embeds: [embed], components: [row1, row2] });
}

// --- MODALS ---
function giftModal() {
  return new ModalBuilder()
    .setCustomId("modal_gift")
    .setTitle("🎁 Gift Candy Canes")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("target")
          .setLabel("Target user ID or @mention")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setValue("10")
      )
    );
}
function heistModal() {
  return new ModalBuilder()
    .setCustomId("modal_heist")
    .setTitle("💀 Heist a player")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("target").setLabel("Target user ID or @mention").setStyle(TextInputStyle.Short)
      )
    );
}
function snowballModal() {
  return new ModalBuilder()
    .setCustomId("modal_snowball")
    .setTitle("❄️ Snowball a player")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("target").setLabel("Target user ID or @mention").setStyle(TextInputStyle.Short)
      )
    );
}

// --- INTERACTION HANDLER ---
client.on("interactionCreate", async (i) => {
  // slash
  if (i.isChatInputCommand()) {
    if (i.commandName === "xmas") return sendXmasPanel(i);
    if (i.commandName === "xmas_admin") {
      if (ADMIN_ROLE_ID && !i.member.roles.cache.has(ADMIN_ROLE_ID)) return i.reply({ content: "No permission.", ephemeral: true });
      const data = readDB();
      const list = Object.entries(data.users)
        .filter(([, v]) => (v.candy || 0) > 0)
        .sort((a, b) => b[1].candy - a[1].candy)
        .slice(0, 25);
      if (!list.length) return i.reply({ content: "No players yet.", ephemeral: true });
      const desc = list
        .map(([id, v]) => `<@${id}> — ${v.candy} 🍬 ${v.lockedUntil ? "🔒" : ""} ${v.nudgeOptOut ? "🚫DM" : ""}`)
        .join("\n");
      const embed = new EmbedBuilder().setTitle("🎄 Candy Heist — Active Players").setDescription(desc);
      return i.reply({ embeds: [embed], ephemeral: true });
    }
  }

// BUTTONS
if (i.isButton()) {
  const id = i.customId;

  // 🎁 Gift → open user select
  if (id === "gift") {
    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("gift_select")
        .setPlaceholder("Select someone to gift")
        .setMinValues(1)
        .setMaxValues(1)
    );
    await i.reply({
      content: "Who do you want to gift? 🎁",
      components: [row],
      ephemeral: true
    });
    return;
  }

  // 💀 Heist → open user select
  if (id === "heist") {
    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("heist_select")
        .setPlaceholder("Select a player to heist")
        .setMinValues(1)
        .setMaxValues(1)
    );
    await i.reply({
      content: "Pick someone to rob 👀",
      components: [row],
      ephemeral: true
    });
    return;
  }

  // ❄️ Snowball → open user select
  if (id === "snowball") {
    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("snowball_select")
        .setPlaceholder("Select a player to snowball")
        .setMinValues(1)
        .setMaxValues(1)
    );
    await i.reply({
      content: "Pick a target to snowball ❄️",
      components: [row],
      ephemeral: true
    });
    return;
  }

  // 🔒 Lock
  if (id === "lock") {
    const until = new Date(Date.now() + 15 * 60000).toISOString();
    setUser(i.user.id, { lockedUntil: until });
    const msg = `${getBanter("lock")} (15 mins)`;
    await i.reply({ content: msg, ephemeral: true });
    return;
  }

  // 🏆 Leaderboard
  if (id === "leaderboard") {
    const data = readDB();
    const list = Object.entries(data.users)
      .filter(([, v]) => (v.candy || 0) > 0)
      .sort((a, b) => b[1].candy - a[1].candy)
      .slice(0, 10);

    if (!list.length) {
      await i.reply({ content: "No players yet 🎄", ephemeral: true });
      return;
    }

    const desc = list
      .map(([uid, v], idx) => `**${idx + 1}.** <@${uid}> — ${v.candy} 🍬`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🏆 Candy Heist Leaderboard")
      .setDescription(desc);

    await i.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}

// USER SELECTS
if (i.isUserSelectMenu()) {
  const targetId = i.values[0];
  const actorId = i.user.id;

  // 🎁 GIFT select → now ask for amount
  if (i.customId === "gift_select") {
    const modal = new ModalBuilder()
      .setCustomId(`modal_gift_amount:${targetId}`)
      .setTitle("🎁 Gift amount")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("amount")
            .setLabel("How many Candy Canes?")
            .setStyle(TextInputStyle.Short)
            .setValue("10")
        )
      );
    await i.showModal(modal);
    return;
  }

  // 💀 HEIST select → do heist now
  if (i.customId === "heist_select") {
    const targetData = getUser(targetId);

    // if target is locked
    if (isLocked(targetId)) {
      const line = getBanter("mug_fail");
      await i.update({
        content: `${line} (they locked their stocking)`,
        components: []
      });
      return;
    }

    const success = Math.random() < 0.7 && (targetData.candy || 0) > 0;

    if (success) {
      const stolen = Math.max(1, Math.floor(targetData.candy * 0.25));
      addCandy(targetId, -stolen);
      addCandy(actorId, stolen);
      const line = getBanter("mug_success");

      await i.update({
        content: `${line}\nYou stole **${stolen}** 🍬 from <@${targetId}>`,
        components: []
      });

      // DM the victim if they didn't opt out
      try {
        const db = readDB();
        const victimData = db.users[targetId];
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (guild) {
          const member = await guild.members.fetch(targetId).catch(() => null);
          if (member && !(victimData && victimData.nudgeOptOut)) {
            await member
              .send(
                `💀 You were hit in **The Candy Heist** by <@${actorId}> and lost **${stolen}** 🍬`
              )
              .catch(() => {});
          }
        }
      } catch (e) {
        // ignore DM errors
      }
    } else {
      addCandy(actorId, -5);
      const line = getBanter("mug_fail");
      await i.update({
        content: `${line}\nYou lost **5** 🍬`,
        components: []
      });
    }

    return;
  }

  // ❄️ SNOWBALL select
  if (i.customId === "snowball_select") {
    const targetData = getUser(targetId);
    const hit =
      Math.random() < 0.5 &&
      (targetData.candy || 0) > 0 &&
      !isLocked(targetId);

    if (hit) {
      const stolen = Math.min(
        targetData.candy,
        Math.floor(Math.random() * 4) + 2 // 2-5
      );
      addCandy(targetId, -stolen);
      addCandy(actorId, stolen);
      const line = getBanter("snowball");
      await i.update({
        content: `${line}\nYou knocked **${stolen}** 🍬 off <@${targetId}>`,
        components: []
      });
    } else {
      await i.update({
        content: "Your snowball missed and hit a reindeer 🦌",
        components: []
      });
    }

    return;
  }
}

// MODAL SUBMITS
if (i.isModalSubmit()) {
  // only gift uses a modal now
  if (i.customId.startsWith("modal_gift_amount:")) {
    const targetId = i.customId.split(":")[1];
    const amount = parseInt(i.fields.getTextInputValue("amount"), 10) || 0;
    const giverId = i.user.id;
    const giverData = getUser(giverId);

    if (amount <= 0) {
      await i.reply({ content: "Amount must be positive.", ephemeral: true });
      return;
    }

    if ((giverData.candy || 0) < amount) {
      await i.reply({ content: "Not enough Candy Canes 🍬", ephemeral: true });
      return;
    }

    addCandy(giverId, -amount);
    addCandy(targetId, amount);
    const line = getBanter("gift_success");
    await i.reply({
      content: `${line}\nYou gave <@${targetId}> **${amount}** 🍬`,
      ephemeral: false
    });
  }
}

          const stolen = Math.min(t.candy, Math.floor(Math.random() * 4) + 2);
          addCandy(targetId, -stolen);
          addCandy(uID, stolen);
          const msg = `${getBanter("snowball")}\nYou knocked **${stolen}** 🍬 off <@${targetId}>`;
          return i.reply(msg);
        } else {
          return i.reply("Your snowball missed and hit a reindeer 🦌");
        }
      }
    }
  });

// --- COMMAND REGISTRATION ---
const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  const commands = [
    { name: "xmas", description: "Open The Candy Heist panel" },
    { name: "xmas_admin", description: "(staff) view active Candy Heist players" }
  ];

  try {
    if (GUILD_ID) {
      // fast guild-only commands
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log("✅ Registered guild commands to", GUILD_ID);
    } else {
      // fallback: global (slower to appear)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log("✅ Registered global commands");
    }
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err.rawError || err);
    // don't crash the bot
  }
}

client.once("ready", async () => {
  console.log(`🎄 Logged in as ${client.user.tag}`);

  // register commands…
  await registerCommands();

  const channelId = process.env.EVENT_CHANNEL_ID;
  if (channelId) {
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setTitle("🎁 The Candy Heist")
      .setDescription("Collect, gift, and steal Candy Canes. Use the buttons below.")
      .setColor(0xE23C3B);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("gift").setLabel("Gift").setEmoji("🎁").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("heist").setLabel("Heist").setEmoji("💀").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("snowball").setLabel("Snowball").setEmoji("❄️").setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("lock").setLabel("Lock Stocking").setEmoji("🔒").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("leaderboard").setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Primary)
    );

    const msg = await channel.send({ embeds: [embed], components: [row1, row2] });
    // optional: await msg.pin();
    console.log("📌 Candy Heist panel posted.");
  }
});


client.login(TOKEN);

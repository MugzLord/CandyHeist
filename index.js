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

// ensure dir for DB exists (fixes ENOENT on /data/db.json)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// --- INIT FILES ---
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify({ users: {}, banter_state: {} }, null, 2)
  );
}

// load banter; fall back if file missing
let banter = {
  gift_success: ["Nice gift!"],
  mug_success: ["You pulled off the heist."],
  mug_fail: ["Heist failed 😅"],
  snowball: ["Snowball hit!"],
  lock: ["Stocking locked."]
};
try {
  if (fs.existsSync(BANTER_PATH)) {
    banter = JSON.parse(fs.readFileSync(BANTER_PATH, "utf-8"));
  }
} catch (e) {
  console.warn("Could not load banter.json, using defaults.");
}

// --- DB HELPERS ---
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function getUser(id) {
  const data = readDB();
  if (!data.users[id]) {
    data.users[id] = {
      candy: 25, // starter candy so they can be robbed
      lockedUntil: null,
      nudgeOptOut: false
    };
    writeDB(data);
    return data.users[id];
  }
  return data.users[id];
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

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// send DM if user allows it
async function dmIfAllowed(userId, message, fallbackGuildId = null) {
  const data = readDB();
  const userData = data.users[userId];

  // if user opted out, don't DM at all
  if (userData && userData.nudgeOptOut) return;

  let guild = null;

  // 1) try env guild
  if (process.env.GUILD_ID) {
    guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  }

  // 2) try guild from interaction
  if (!guild && fallbackGuildId) {
    guild = await client.guilds.fetch(fallbackGuildId).catch(() => null);
  }

  // 3) fallback: first guild the bot is in
  if (!guild) {
    const guilds = await client.guilds.fetch().catch(() => null);
    if (guilds && guilds.size > 0) {
      const first = guilds.first();
      if (first) {
        guild = await client.guilds.fetch(first.id).catch(() => null);
      }
    }
  }

  if (!guild) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  // build a DM-only row so user can toggle dm off/on
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("toggle_dm")
      .setLabel("DMs: On/Off")
      .setEmoji("📩")
      .setStyle(ButtonStyle.Secondary)
  );

  await member
    .send({
      content: message,
      components: [row]
    })
    .catch(() => {});
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

// --- INTERACTION HANDLER ---
client.on("interactionCreate", async (i) => {
  // slash
  if (i.isChatInputCommand()) {
    if (i.commandName === "xmas") return sendXmasPanel(i);
    if (i.commandName === "xmas_admin") {
      if (ADMIN_ROLE_ID && !i.member.roles.cache.has(ADMIN_ROLE_ID)) {
        return i.reply({ content: "No permission.", ephemeral: true });
      }
      const data = readDB();
      const list = Object.entries(data.users)
        .filter(([, v]) => (v.candy || 0) > 0)
        .sort((a, b) => b[1].candy - a[1].candy)
        .slice(0, 25);
      if (!list.length) return i.reply({ content: "No players yet.", ephemeral: true });
      const desc = list
        .map(
          ([id, v]) =>
            `<@${id}> — ${v.candy} 🍬 ${v.lockedUntil ? "🔒" : ""} ${v.nudgeOptOut ? "🚫DM" : ""}`
        )
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

      const desc = list.map(([uid, v], idx) => `**${idx + 1}.** <@${uid}> — ${v.candy} 🍬`).join("\n");

      const embed = new EmbedBuilder().setTitle("🏆 Candy Heist Leaderboard").setDescription(desc);
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

      // target broke
      if ((targetData.candy || 0) === 0) {
        await i.update({
          content: "They had 0 🍬 — try someone richer 😏",
          components: []
        });
        return;
      }

      // target locked
      if (isLocked(targetId)) {
        const line = getBanter("mug_fail");
        await i.update({
          content: `${line} (they locked their stocking)`,
          components: []
        });
        return;
      }

      const success = Math.random() < 0.7;
      if (success) {
        const stolen = Math.max(1, Math.floor(targetData.candy * 0.25));
        addCandy(targetId, -stolen);
        addCandy(actorId, stolen);
        const line = getBanter("mug_success");

        await i.update({
          content: `${line}\nYou stole **${stolen}** 🍬 from <@${targetId}>`,
          components: []
        });

        await dmIfAllowed(
          targetId,
          `💀 You were heisted by <@${actorId}> and lost **${stolen}** 🍬 in **The Candy Heist**.`,
          i.guild?.id
        );

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
        Math.random() < 0.5 && (targetData.candy || 0) > 0 && !isLocked(targetId);

      if (hit) {
        const stolen = Math.min(
          targetData.candy,
          Math.floor(Math.random() * 4) + 2 // 2–5
        );
        addCandy(targetId, -stolen);
        addCandy(actorId, stolen);
        const line = getBanter("snowball");

        await i.update({
          content: `${line}\nYou knocked **${stolen}** 🍬 off <@${targetId}>`,
          components: []
        });

        await dmIfAllowed(
          targetId,
          `❄️ You got snowballed by <@${actorId}> and dropped **${stolen}** 🍬 in **The Candy Heist**!`,
          i.guild?.id
        );

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

      await dmIfAllowed(
        targetId,
        `🎁 You got **${amount}** Candy Canes from <@${giverId}> in **The Candy Heist**!`,
        i.guild?.id
      );

    }
  }
});

// --- COMMAND REGISTRATION ---
const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  const commands = [
  {
    name: "xmas",
    description: "Open The Candy Heist panel",
    dm_permission: false   // ⬅️ DISABLE in DMs
  },
  {
    name: "xmas_admin",
    description: "(staff) view active Candy Heist players",
    dm_permission: false   // admin command shouldn’t be in DMs either
  }
];


  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands
      });
      console.log("✅ Registered guild commands to", GUILD_ID);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Registered global commands");
    }
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err.rawError || err);
  }
}

client.once("ready", async () => {
  console.log(`🎄 Logged in as ${client.user.tag}`);

  await registerCommands();

  if (EVENT_CHANNEL_ID) {
    const channel = await client.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
    if (channel) {
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

      // new row for DM toggle (or more controls)
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("toggle_dm").setLabel("DMs: On/Off").setEmoji("📩").setStyle(ButtonStyle.Secondary)
      );

      await channel.send({
        embeds: [embed],
        components: [row1, row2, row3]
      });

      console.log("📌 Candy Heist panel posted.");
    }
  }
}); // <-- this closes client.once("ready", ...)

client.login(TOKEN); // <-- this must be the last line

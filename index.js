// index.js
// 🎁 The Candy Heist — discord.js v14 (ESM)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from "discord.js";

// keep track of the last Candy Heist panel per channel
const lastPanelMessages = new Map(); // key: channelId, value: messageId

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.json");
const BANTER_PATH = path.join(__dirname, "banter.json");
const IMAGES_DIR = path.join(__dirname, "images");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify({ users: {}, banter_state: {} }, null, 2)
  );
}

let banter = {
  gift_success: ["Nice gift!"],
  mug_success: ["You pulled off the heist."],
  mug_fail: ["Heist failed 😅"],
  snowball: ["Snowball hit!"],
  lock: ["Stocking locked."],
};
try {
  if (fs.existsSync(BANTER_PATH)) {
    banter = JSON.parse(fs.readFileSync(BANTER_PATH, "utf-8"));
  }
} catch {
  console.warn("Could not load banter.json, using defaults.");
}

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
      candy: 25,
      lockedUntil: null,
      nudgeOptOut: false,
    };
    writeDB(data);
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

async function dmIfAllowed(userId, message, fallbackGuildId = null) {
  const data = readDB();
  const userData = data.users[userId];
  if (userData && userData.nudgeOptOut) return; // user said no DMs

  let guild = null;

  // 1) try env guild first
  if (GUILD_ID) {
    guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  }

  // 2) try the guild from the interaction (we pass it in)
  if (!guild && fallbackGuildId) {
    guild = await client.guilds.fetch(fallbackGuildId).catch(() => null);
  }

  // 3) last resort: first guild the bot is in
  if (!guild) {
    const all = await client.guilds.fetch().catch(() => null);
    if (all && all.size > 0) {
      const first = all.first();
      guild = await client.guilds.fetch(first.id).catch(() => null);
    }
  }

  if (!guild) {
    console.log(`[DM] No guild found to DM user ${userId}`);
    return;
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    console.log(`[DM] User ${userId} not found in guild ${guild.id}`);
    return;
  }

  // open/create DM channel
  const dm = await member.createDM().catch(() => null);
  if (!dm) return;

  // if we have a previous DM id, try to delete it
  const lastDmId = userData?.lastDmId;
  if (lastDmId) {
    await dm.messages.delete(lastDmId).catch(() => {
      // ignore if already gone / can't delete
    });
  }

  // build the toggle row
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("toggle_dm")
      .setLabel("DMs: On/Off")
      .setEmoji("📩")
      .setStyle(ButtonStyle.Secondary)
  );

  // send the fresh DM
  const sent = await dm
    .send({
      content: message,
      components: [row],
    })
    .catch((err) => {
      console.log(`[DM] Failed to DM ${userId}: ${err.message}`);
      return null;
    });

  // store the new DM id so next time we can delete it
  if (sent) {
    const newData = readDB();
    if (!newData.users[userId]) newData.users[userId] = {};
    newData.users[userId].lastDmId = sent.id;
    writeDB(newData);
  }
}

// send one random image from /images
async function sendRandomImage(channel) {
  try {
    if (!fs.existsSync(IMAGES_DIR)) return;
    const files = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) =>
        [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(
          path.extname(f).toLowerCase()
        )
      );
    if (!files.length) return;
    const rand = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(IMAGES_DIR, rand);
    await channel.send({ files: [filePath] });
  } catch (err) {
    console.warn("Could not send random image:", err.message);
  }
}

// ⬇️ NEW: random loop — 35 to 75 mins between drops
function startRandomImageLoop(channel) {
  async function loop() {
    const minMinutes = 35;
    const maxMinutes = 75;
    const delayMinutes =
      Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    const delayMs = delayMinutes * 60 * 1000;

    await new Promise((res) => setTimeout(res, delayMs));
    await sendRandomImage(channel).catch(() => {});
    loop();
  }
  loop();
}

async function disableOldPanel(channelId) {
  const msgId = lastPanelMessages.get(channelId);
  if (!msgId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);

    const disabledComponents = msg.components.map((row) => {
      return new ActionRowBuilder().addComponents(
        row.components.map((c) => ButtonBuilder.from(c).setDisabled(true))
      );
    });

    await msg.edit({ components: disabledComponents });
  } catch (err) {
    // ignore
  }
}

// ✅ ONLY ONE VERSION OF THIS
async function sendXmasPanel(interaction) {
  await disableOldPanel(interaction.channel.id);

  const embed = new EmbedBuilder()
    .setTitle("🎁 The Candy Heist")
    .setDescription("Collect, gift, and steal Candy Canes. Use the buttons below.")
    .setColor(0xe23c3b);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("gift")
      .setLabel("Gift")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("heist")
      .setLabel("Heist")
      .setEmoji("💀")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("snowball")
      .setLabel("Snowball")
      .setEmoji("❄️")
      .setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lock")
      .setLabel("Lock Stocking")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("leaderboard")
      .setLabel("Leaderboard")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Primary)
  );

  const sent = await interaction.reply({
    embeds: [embed],
    components: [row1, row2],
    fetchReply: true,
  });

  lastPanelMessages.set(interaction.channel.id, sent.id);
}

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
      if (!list.length)
        return i.reply({ content: "No players yet.", ephemeral: true });

      const desc = list
        .map(
          ([id, v]) =>
            `<@${id}> — ${v.candy} 🍬 ${v.lockedUntil ? "🔒" : ""} ${
              v.nudgeOptOut ? "🚫DM" : ""
            }`
        )
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🎄 Candy Heist — Active Players")
        .setDescription(desc);
      return i.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // buttons
  if (i.isButton()) {
    const id = i.customId;

    if (id === "toggle_dm") {
      const userId = i.user.id;
      const userData = getUser(userId);
      const nowOptOut = !userData.nudgeOptOut;
      setUser(userId, { nudgeOptOut: nowOptOut });

      const newLabel = nowOptOut ? "DMs: Off" : "DMs: On";
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("toggle_dm")
          .setLabel(newLabel)
          .setEmoji(nowOptOut ? "📪" : "📩")
          .setStyle(ButtonStyle.Secondary)
      );

      await i.update({
        content: nowOptOut
          ? "📪 Okay, I will stop DM’ing you for Candy Heist."
          : "📬 DMs turned back on — you’ll get heist/gift notices again.",
        components: [row],
      });
      return;
    }

    if (id === "gift" || id === "heist" || id === "snowball") {
      const guild = i.guild;
      if (!guild)
        return i.reply({ content: "Use this in a server.", ephemeral: true });

      const members = await guild.members.fetch();
      const humans = members.filter((m) => !m.user.bot).first(25);
      const options = humans.map((m) => ({
        label: m.displayName || m.user.username,
        value: m.id,
        description:
          id === "gift"
            ? `Gift ${m.user.username}`
            : id === "heist"
            ? `Heist ${m.user.username}`
            : `Snowball ${m.user.username}`,
      }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${id}_select_humans`)
        .setPlaceholder(
          id === "gift"
            ? "Who do you want to gift? 🎁"
            : id === "heist"
            ? "Select a player to heist"
            : "Select a player to snowball"
        )
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);

      await i.reply({
        content:
          id === "gift"
            ? "Pick someone to gift 🎁"
            : id === "heist"
            ? "Pick someone to rob 👀"
            : "Pick a target to snowball ❄️",
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (id === "lock") {
      const until = new Date(Date.now() + 15 * 60_000).toISOString();
      setUser(i.user.id, { lockedUntil: until });
      const msg = `${getBanter("lock")} (15 mins)`;
      await i.reply({ content: msg, ephemeral: true });
      return;
    }

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
        .map(
          ([uid, v], idx) => `**${idx + 1}.** <@${uid}> — ${v.candy} 🍬`
        )
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🏆 Candy Heist Leaderboard")
        .setDescription(desc);
      await i.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  // select menus
  if (i.isStringSelectMenu()) {
    const targetId = i.values[0];
    const actorId = i.user.id;

    if (i.customId === "gift_select_humans") {
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

    if (i.customId === "heist_select_humans") {
      const targetData = getUser(targetId);
      if ((targetData.candy || 0) === 0) {
        await i.update({
          content: "They had 0 🍬 — try someone richer 😏",
          components: [],
        });
        return;
      }
      if (isLocked(targetId)) {
        const line = getBanter("mug_fail");
        await i.update({
          content: `${line} (they locked their stocking)`,
          components: [],
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
          components: [],
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
          components: [],
        });
      }
      return;
    }

    if (i.customId === "snowball_select_humans") {
      const targetData = getUser(targetId);
      const hit =
        Math.random() < 0.5 &&
        (targetData.candy || 0) > 0 &&
        !isLocked(targetId);

      if (hit) {
        const stolen = Math.min(
          targetData.candy,
          Math.floor(Math.random() * 4) + 2
        );
        addCandy(targetId, -stolen);
        addCandy(actorId, stolen);
        const line = getBanter("snowball");
        await i.update({
          content: `${line}\nYou knocked **${stolen}** 🍬 off <@${targetId}>`,
          components: [],
        });
        await dmIfAllowed(
          targetId,
          `❄️ You got snowballed by <@${actorId}> and dropped **${stolen}** 🍬 in **The Candy Heist**!`,
          i.guild?.id
        );
      } else {
        await i.update({
          content: "Your snowball missed and hit a reindeer 🦌",
          components: [],
        });
      }
      return;
    }
  }

  // modals
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
        await i.reply({
          content: "Not enough Candy Canes 🍬",
          ephemeral: true,
        });
        return;
      }

      addCandy(giverId, -amount);
      addCandy(targetId, amount);
      const line = getBanter("gift_success");
      await i.reply({
        content: `${line}\nYou gave <@${targetId}> **${amount}** 🍬`,
        ephemeral: false,
      });
      await dmIfAllowed(
        targetId,
        `🎁 You got **${amount}** Candy Canes from <@${giverId}> in **The Candy Heist**!`,
        i.guild?.id
      );
    }
  }
});

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  const commands = [
    {
      name: "xmas",
      description: "Open The Candy Heist panel",
      dm_permission: false,
    },
    {
      name: "xmas_admin",
      description: "(staff) view active Candy Heist players",
      dm_permission: false,
    },
  ];
  try {
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log("✅ Registered guild commands to", GUILD_ID);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commands,
      });
      console.log("✅ Registered global commands");
    }
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
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
        .setColor(0xe23c3b);

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("gift")
          .setLabel("Gift")
          .setEmoji("🎁")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("heist")
          .setLabel("Heist")
          .setEmoji("💀")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("snowball")
          .setLabel("Snowball")
          .setEmoji("❄️")
          .setStyle(ButtonStyle.Secondary)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("lock")
          .setLabel("Lock Stocking")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("leaderboard")
          .setLabel("Leaderboard")
          .setEmoji("🏆")
          .setStyle(ButtonStyle.Primary)
      );
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("toggle_dm")
          .setLabel("DMs: On/Off")
          .setEmoji("📩")
          .setStyle(ButtonStyle.Secondary)
      );

      // 1) grey the previous panel in this channel
      await disableOldPanel(channel.id);

      // 2) send the new panel
      const sent = await channel.send({
        embeds: [embed],
        components: [row1, row2, row3],
      });

      // 3) remember this as the latest panel
      lastPanelMessages.set(channel.id, sent.id);

      // send 1 pic immediately
      await sendRandomImage(channel);
      // and start the random loop
      startRandomImageLoop(channel);

      console.log("📌 Candy Heist panel posted + random image loop started.");
    }
  }
});

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN not set");
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID not set");
  process.exit(1);
}

client.login(TOKEN);

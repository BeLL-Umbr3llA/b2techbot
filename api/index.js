require('dotenv').config();
const { Bot, webhookCallback, InlineKeyboard } = require("grammy");
const { connectDB, Match, LiveCache, User, ApiLog } = require("../db"); // ApiLog ထည့်သွင်းထားသည်
const Fuse = require("fuse.js");
const axios = require('axios');
const bot = new Bot(process.env.BOT_TOKEN);

// --- ၀။ Topic Configuration ---
// သင်အသုံးပြုလိုသော Topic ID ကို ဒီမှာ ထည့်ပေးပါ (ဥပမာ: ၂)
const TARGET_TOPIC_ID = 2; 

// Middleware: သတ်မှတ်ထားတဲ့ Topic ID ကလွဲရင် ကျန်တာ အကုန် Block မယ်
bot.use(async (ctx, next) => {
    const messageThreadId = ctx.message?.message_thread_id || ctx.callbackQuery?.message?.message_thread_id;
    
    if (messageThreadId === TARGET_TOPIC_ID) {
        return next();
    }
    // Topic ID မတူရင် ဘာမှပြန်မလုပ်ဘူး
    return;
});

// --- ၁။ Configuration ---
const leagueNames = {
    "1": "🏆 FIFA World Cup", "2": "🇪🇺 Champions League", "3": "🇪🇺 Europa League",
    "848": "🇪🇺 UEFA Conference League", "39": "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League", "140": "🇪🇸 La Liga",
    "135": "🇮🇹 Serie A", "78": "🇩🇪 Bundesliga", "61": "🇫🇷 Ligue 1",
    "40": "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship", "88": "🇳🇱 Eredivisie", "94": "🇵🇹 Primeira Liga",
    "71": "🇧🇷 Serie A", "13": "🌎 Libertadores", "235": "🇷🇺 Russia Premier League",
    "466": "🇲🇲 Myanmar League"
};

const toMMT = (date) => new Date(date).toLocaleString('en-GB', { 
    timeZone: 'Asia/Yangon', 
    day: '2-digit', 
    month: 'short', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
});

const getFunnyWaitingMsg = () => {
    const msgs = [
        "အသင်းကြီးတွေဆိုတော့ ပြောစရာမလိုတော့ဘူးပေါ့။ 🔥",
        "ဒီပွဲကတော့ အကြိတ်အနယ် ဖြစ်ဦးမှာပဲ။ 🍿",
        "ရင်ခုန်ဖို့ အဆင်သင့်ပဲလား? 💓",
        "အသင်းကြီးဆိုပြီး အားမကိုးနဲ့နော်၊ သွေးတက်သွားမယ်။ 🩸",
        "ကြည့်ရတာ ဒီပွဲကတော့ ဂိုးမိုးရွာမယ့်ပုံပဲ။ ⛈️",
        "အိပ်ချင်ရင် အိပ်လိုက်တော့၊ မနက်မှ Score ကြည့်ပြီး ငိုဖို့ ပြင်ထား။ 😭",
        "ဒီပွဲကတော့ အသည်းကွဲမလား၊ အရက်သောက်ရမလားပဲ။ 🍻",
        "မောင်လေးတို့ရေ... ဒီညတော့ အရဲစွန့်ကိုင်လိုက်နော် 🦁",
        "ဘောလုံးက လုံးတယ်ဆိုတာ မမေ့နဲ့ဦး၊ အိပ်ရေးပျက်ရုံတင် မကဘူးနော်။ ⚽"
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
};

const escapeMarkdown = (text) => {
    if (!text) return "";
    return text.replace(/[_*`[\]]/g, '\\$&');
};

async function fetchLiveFromAPI(fixtureId) {
    try {
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { id: fixtureId },
            headers: {
                'x-rapidapi-key': process.env.APISPORTS_KEY,
                'x-rapidapi-host': 'v3.football.api-sports.io'
            }
        };
        const response = await axios.request(options);
        const data = response.data.response[0];
        
        if (data) {
            return {
                score: `${data.goals.home}-${data.goals.away}`,
                elapsed: data.fixture.status.elapsed,
                status: data.fixture.status.short
            };
        }
        return null;
    } catch (error) {
        console.error("❌ API Fetch Error:", error);
        return null;
    }
}

// --- ၂။ Match Detail (Clean Layout) ---
async function sendMatchDetail(ctx, m) {
    try {
        let cache = await LiveCache.findOne({ fixtureId: Number(m.fixtureId) });
        let liveInfo = cache ? { score: cache.score, elapsed: cache.elapsed } : null;

        const now = new Date();
        const matchTime = new Date(m.utcDate);
        
        if (!liveInfo && now >= matchTime) {
            const today = new Date().toISOString().split('T')[0];
            const apiData = await fetchLiveFromAPI(m.fixtureId);

            if (apiData && apiData.status !== 'NS') {
                liveInfo = apiData;
                try {
                    await ApiLog.updateOne(
                        { date: today },
                        { $inc: { count: 1 } },
                        { upsert: true }
                    );
                } catch (logErr) {
                    console.error("❌ Log Error:", logErr);
                }
            }
        }

        let statusText = liveInfo ? `ပွဲကစားနေသည် (${liveInfo.elapsed}')` : "ပွဲမစသေးပါ";
        let scoreText = liveInfo ? `\`${liveInfo.score}\`` : getFunnyWaitingMsg();

        const msg = 
            `⚽️ *ပွဲစဉ်အသေးစိတ်*\n\n` +
            `🏆 *${escapeMarkdown(m.leagueName)}*\n` +
            `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*\n` +
            `📅 *${toMMT(m.utcDate)}*\n` +
            `🔢 ${scoreText}\n` +
            `🕒 *အခြေအနေ:* ${statusText}`;

        const kb = new InlineKeyboard().text("🔔 Notification ယူမယ်", `sub_${m.fixtureId}`);
        
        await ctx.reply(msg, { 
            parse_mode: "Markdown", 
            reply_markup: kb,
            message_thread_id: TARGET_TOPIC_ID // စာပြန်ရင် Topic ထဲမှာပဲပြန်မယ်
        });
    } catch (err) {
        console.error("❌ Detail Error:", err);
    }
}

// --- ၃။ Bot Commands ---
bot.command("start", async (ctx) => {
    const welcome = 
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚽ *B2TECH FOOTBALL SERVICE* ⚽️\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `WELCOMEပါနော်  \n` +
        `ဒီ Bot ကနေတစ်ဆင့် ဘောလုံးသတင်းနဲ့ \n` +
        `ပွဲစဉ်ရလဒ်တွေကို တိုက်ရိုက်ကြည့်နိုင်ပါတယ်။\n\n` +
        `📌 *အသုံးပြုနိုင်သည့် Command များ*\n\n` +
        `📅 /match  - ယနေ့ပွဲစဉ်ဇယား\n` +
        `🔴 /live   - ယခုကစားနေသည့်ပွဲစဉ်များ\n` +
        `🔍 /team   - အသင်းအမည်ဖြင့် ရှာဖွေရန်\n\n` +
        `_ဥပမာ - /man_u\n` +
        `━━━━━━━━━━━━━━━━━━`;

    await ctx.reply(welcome, { parse_mode: "Markdown", message_thread_id: TARGET_TOPIC_ID });
});

bot.command("match", async (ctx) => {
    try {
        await connectDB();
        const matches = await Match.find().sort({ utcDate: 1 });
        const leagueMap = new Map();

        matches.forEach(m => {
            const lid = m.leagueId ? String(m.leagueId) : null;
            if (lid) {
                if (!leagueMap.has(lid)) {
                    leagueMap.set(lid, { name: leagueNames[lid] || m.leagueName, count: 0 });
                }
                leagueMap.get(lid).count++;
            }
        });

        if (leagueMap.size === 0) return ctx.reply("⚽️ ယနေ့အတွက် ပွဲစဉ်များ မရှိသေးပါ。", { message_thread_id: TARGET_TOPIC_ID });

        const kb = new InlineKeyboard();
        leagueMap.forEach((data, id) => {
            kb.text(`${data.name} (${data.count})`, `lg_${id}`).row();
        });

        await ctx.reply("🏆 *League တစ်ခုကို ရွေးချယ်ပါ*", { 
            parse_mode: "Markdown", 
            reply_markup: kb,
            message_thread_id: TARGET_TOPIC_ID 
        });
    } catch (err) { console.error("❌ Match Error:", err); }
});

bot.command("live", async (ctx) => {
    try {
        await connectDB();
        const liveMatches = await LiveCache.find();
        if (liveMatches.length === 0) return ctx.reply("⚽️ လောလောဆယ် Live ကစားနေသည့်ပွဲ မရှိပါ။", { message_thread_id: TARGET_TOPIC_ID });

        const kb = new InlineKeyboard();
        liveMatches.forEach(m => {
            kb.text(`${m.home} ${m.score} ${m.away}`, `sh_${m.fixtureId}`).row();
        });
        await ctx.reply("🔴 *LIVE SCORES*", { 
            parse_mode: "Markdown", 
            reply_markup: kb,
            message_thread_id: TARGET_TOPIC_ID 
        });
    } catch (err) { console.error("❌ Live Error:", err); }
});

// --- ၄။ Handlers ---
bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    try {
        await connectDB();

        if (data.startsWith("lg_")) {
            const lidRaw = data.split("_")[1];
            const matches = await Match.find({ 
                $or: [{ leagueId: Number(lidRaw) }, { leagueId: String(lidRaw) }] 
            }).sort({ utcDate: 1 });
            
            if (matches.length === 0) return ctx.reply("⚠️ ပွဲစဉ်မရှိပါ။", { message_thread_id: TARGET_TOPIC_ID });

            let header = `🏆 *${escapeMarkdown(leagueNames[lidRaw] || "ပွဲစဉ်များ")}*\n` +
                         `━━━━━━━━━━━━━━━\n\n`;

            let matchLines = "";
            matches.forEach((m) => {
                const timeStr = toMMT(m.utcDate);
                const teamLine = `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*`;
                const detailLink = `/${escapeMarkdown(m.home.replace(/\s+/g, '_'))}`;
                matchLines += `📅 ${timeStr}\n${teamLine}\n👉 click >> ${detailLink}\n\n`;
            });

            return ctx.reply(header + matchLines, { parse_mode: "Markdown", message_thread_id: TARGET_TOPIC_ID });
        }

        if (data.startsWith("sh_")) {
            const fid = Number(data.split("_")[1]);
            const m = await Match.findOne({ fixtureId: fid });
            if (m) return sendMatchDetail(ctx, m);
        }

        if (data.startsWith("sub_")) {
            const fid = Number(data.split("_")[1]);
            const m = await Match.findOne({ fixtureId: fid });
            if (!m) return ctx.reply("❌ ပွဲစဉ်မတွေ့ပါ။", { message_thread_id: TARGET_TOPIC_ID });

            await User.updateOne(
                { userId: ctx.from.id },
                { $addToSet: { subscriptions: { fixtureId: fid, home: m.home, away: m.away, isStartedNotified: false } } },
                { upsert: true }
            );
            return ctx.reply(`🔔 *${escapeMarkdown(m.home)}* ပွဲအတွက် Notification\n မှတ်သားပေးထားပြီးပါပြီခင်ဗျာ။`, { 
                parse_mode: "Markdown",
                message_thread_id: TARGET_TOPIC_ID 
            });
        }
    } catch (err) {
        console.error("❌ Callback Error:", err);
    }
});

bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text.startsWith("/")) return;
    
    const commandWithoutUsername = text.split('@')[0]; 
    
    const query = commandWithoutUsername.substring(1).replace(/_/g, ' ').toLowerCase();
    const commonCmds = ["match", "live", "start"];
    if (commonCmds.includes(query)) return;

    try {
        await connectDB();
        const allMatches = await Match.find();
        const fuse = new Fuse(allMatches, { 
            keys: ["home", "away"], 
            threshold: 0.35 
        });

        const result = fuse.search(query);

        if (result.length > 0) {
            await sendMatchDetail(ctx, result[0].item);
        } else {
            await ctx.reply("🔍 ရှာဖွေမှုမတွေ့ပါ။ အသင်းနာမည် ပြန်စစ်ပေးပါဦး။", { message_thread_id: TARGET_TOPIC_ID });
        }
    } catch (err) { 
        console.error("❌ Search Error:", err); 
    }
});

bot.catch((err) => console.error("🔥 Global Error:", err));

if (process.env.NODE_ENV !== 'production') {
    connectDB().then(() => {
        console.log("🚀 Bot is running locally...");
        bot.start();
    });
} else {
    module.exports = webhookCallback(bot, "http");
}

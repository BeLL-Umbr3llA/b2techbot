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

async function syncAndNotify(targetFixtureId) {
    try {
        // Top Leagues: PL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, Myanmar League
        const topLeagues = [39, 140, 135, 78, 61, 2, 466]; 
        
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { live: 'all', league: topLeagues.join('-') },
            headers: {
                'x-rapidapi-key': process.env.APISPORTS_KEY,
                'x-rapidapi-host': 'v3.football.api-sports.io'
            }
        };

        const response = await axios.request(options);
        let liveFixtures = response.data.response;

        // User ရှာတဲ့ပွဲက Top League ထဲမပါရင် အဲ့တစ်ပွဲတည်း သီးသန့်ထပ်ဆွဲမယ်
        const isTargetFound = liveFixtures.some(f => f.fixture.id === Number(targetFixtureId));
        if (!isTargetFound) {
            const singleMatch = await axios.get('https://v3.football.api-sports.io/fixtures', {
                params: { id: targetFixtureId },
                headers: options.headers
            });
            if (singleMatch.data.response[0]) {
                liveFixtures.push(singleMatch.data.response[0]);
            }
        }
    
        // --- Notification API ဆီ ဒေတာပို့ခြင်း ---
        // ဤနေရာတွင် check-noti.js သည် ဒေတာလက်ခံပြီး Noti ပို့ခြင်းနှင့် LiveCache Update လုပ်ခြင်းကို တာဝန်ယူရမည်
        if (liveFixtures.length > 0) {
            await axios.post(`${process.env.INTERNAL_API_URL}/api/check-noti`, {
                fixtures: liveFixtures
            }).catch(err => console.error("❌ Noti API Forward Error:", err.message));
        }

        return liveFixtures;
        
    } catch (error) {
        console.error("❌ Sync Logic Error:", error);
        return [];
    }
}

async function sendMatchDetail(ctx, m) {
    try {
        const now = new Date();
        const matchTime = new Date(m.utcDate);

        // --- အခြေအနေ (၁) - ပွဲမစသေးလျှင် ---
        if (now < matchTime) {
            // Funny Message ကို ယူမယ်
            const funnyMsg = getFunnyWaitingMsg();
            
         const msg = 
                    `⚽️ *ပွဲစဉ်အသေးစိတ်*\n\n` +
                    `🏆 *${escapeMarkdown(m.leagueName)}*\n` +
                    `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*\n` +
                    `📅 *${toMMT(m.utcDate)}*\n\n` +
                    `💬 ${escapeMarkdown(funnyMsg)}\n` + // ဒီနေရာမှာ funnyMsg ကို Markdown အပိတ် * ထည့်လိုက်ပါပြီ
                    `🕒 *အခြေအနေ:* ပွဲမစသေးပါ`;
            
            return ctx.reply(msg, { 
                parse_mode: "Markdown", 
                reply_markup: new InlineKeyboard().text("🔔 Notification ယူမယ်", `sub_${m.fixtureId}`),
                message_thread_id: TARGET_TOPIC_ID 
            });
        }

        // --- အခြေအနေ (၂) - ပွဲစနေပြီဆိုလျှင် Live Cache မှာအရင်ရှာ ---
        let cache = await LiveCache.findOne({ fixtureId: Number(m.fixtureId) });
        const isOld = cache && (Date.now() - new Date(cache.updatedAt).getTime() > 3 * 60 * 1000);

        // --- အခြေအနေ (၃) - Cache မရှိလျှင် သို့မဟုတ် ဒေတာဟောင်းနေလျှင် API Call & Sync ---
        if (!cache || isOld) {
            await syncAndNotify(m.fixtureId);
            
            // API ပို့ပြီး Noti API က DB ထဲသိမ်းချိန်ကို ခဏစောင့်ပေးမယ် (1.5 sec)
            await new Promise(r => setTimeout(r, 1500));
            cache = await LiveCache.findOne({ fixtureId: Number(m.fixtureId) });
        }

        // ရလဒ် ထုတ်ပြခြင်း (Live ပွဲများအတွက်)
        let scoreDisplay = cache ? `\`${cache.score}\`` : "0-0";
        let statusDisplay = cache ? `ပွဲကစားနေသည် (${cache.elapsed}')` : "ပွဲစတင်နေပါပြီ";
        
        if (cache && ['FT', 'AET', 'PEN'].includes(cache.status)) {
            statusDisplay = "ပွဲပြီးဆုံးသွားပါပြီ (Full Time)";
        }

        const msg = 
            `⚽️ *ပွဲစဉ်အသေးစိတ် (Live)*\n\n` +
            `🏆 *${escapeMarkdown(m.leagueName)}*\n` +
            `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*\n` +
            `🔢 ရလဒ်: ${scoreDisplay}\n` +
            `🕒 အခြေအနေ: *${statusDisplay}*`;

        await ctx.reply(msg, { 
            parse_mode: "Markdown", 
            reply_markup: new InlineKeyboard().text("🔄 Update ပြန်ကြည့်ရန်", `sh_${m.fixtureId}`),
            message_thread_id: TARGET_TOPIC_ID 
        });

    } catch (err) {
        console.error("❌ Search Response Error:", err);
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

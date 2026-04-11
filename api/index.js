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
        await connectDB();
        const now = new Date();
        
        // --- Global Sync Lock စစ်ဆေးခြင်း ---
        const globalTimer = await LiveCache.findOne({ type: "global_sync_timer" });
        if (globalTimer) {
            const lastSync = new Date(globalTimer.lastUpdated).getTime();
            const diffSecs = (now.getTime() - lastSync) / 1000;
            
            // ၁၈၀ စက္ကန့် (၃ မိနစ်) မပြည့်သေးရင် API မခေါ်တော့ဘူး
            if (diffSecs < 180) {
                console.log(`⏳ [Rate Limit] Global sync was done ${Math.round(diffSecs)}s ago. Skipping API...`);
                // လက်ရှိ DB ထဲမှာရှိနေတဲ့ Live data တွေကိုပဲ ပြန်ပေးလိုက်မယ်
                const existingLive = await LiveCache.find({ fixtureId: { $exists: true } });
                return existingLive.map(l => ({
                    fixture: { id: l.fixtureId, status: { short: l.status, elapsed: l.elapsed } },
                    goals: { home: Number(l.score.split('-')[0]), away: Number(l.score.split('-')[1]) },
                    teams: { home: { name: l.home }, away: { name: l.away } }
                }));
            }
        }

        // --- ၃ မိနစ်ကျော်မှသာ အောက်က API ခေါ်တဲ့အပိုင်းကို အလုပ်လုပ်မယ် ---
        console.log("📡 [API Call] 3 minutes passed. Fetching all live matches...");
        const topLeagues = [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];
        
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { live: 'all' },
            headers: {
                'x-rapidapi-key': process.env.APISPORTS_KEY,
                'x-rapidapi-host': 'v3.football.api-sports.io'
            }
        };

        const response = await axios.request(options);
        const allLiveFixtures = response.data.response;

        // Global Timer ကို Update လုပ်မယ်
        await LiveCache.findOneAndUpdate(
            { type: "global_sync_timer" },
            { lastUpdated: now },
            { upsert: true }
        );

        const filteredFixtures = allLiveFixtures.filter(f => 
            topLeagues.includes(f.league.id) || f.fixture.id === Number(targetFixtureId)
        );

        if (filteredFixtures.length > 0) {
            axios.post(`${process.env.INTERNAL_API_URL}/api/check-noti`, {
                fixtures: filteredFixtures
            }).catch(err => console.error("❌ Noti API Async Error:", err.message));
            
            console.log(`✅ Cache Update sent for ${filteredFixtures.length} matches.`);
        }
        
        return filteredFixtures;
        
    } catch (error) {
        console.error("❌ Sync Logic Error:", error.message);
        return [];
    }
}

async function sendMatchDetail(ctx, m) {
    try {
        const now = new Date();
        const matchTime = new Date(m.utcDate);

        // --- အခြေအနေ (၁) - ပွဲမစသေးလျှင် ---
        if (now < matchTime) {
            const funnyMsg = getFunnyWaitingMsg();
            const msg = 
                `⚽️ *ပွဲစဉ်အသေးစိတ်*\n\n` +
                `🏆 *${escapeMarkdown(m.leagueName)}*\n` +
                `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*\n` +
                `📅 *${toMMT(m.utcDate)}*\n\n` +
                `💬 ${escapeMarkdown(funnyMsg)}\n` +
                `🕒 *အခြေအနေ:* ပွဲမစသေးပါ`;
            
            return ctx.reply(msg, { 
                parse_mode: "Markdown", 
                reply_markup: new InlineKeyboard().text("🔔 Notification ယူမယ်", `sub_${m.fixtureId}`),
                message_thread_id: TARGET_TOPIC_ID 
            });
        }

       // ၁။ Cache ရှာပြီး အချိန်စစ်မယ်
let cache = await LiveCache.findOne({ fixtureId: Number(m.fixtureId) });
let shouldFetch = false;

// Global Timer ကိုပါ တွဲစစ်မယ် (တစ်ခါခေါ်ရင် ပွဲအားလုံးအတွက် data ရလို့)
const globalTimer = await LiveCache.findOne({ type: "global_sync_timer" });
const nowTs = Date.now();

if (!cache) {
    // ပွဲစဉ်အတွက် cache မရှိရင်တောင် Global call က ၃ မိနစ်အတွင်း ခေါ်ထားရင် မခေါ်တော့ဘူး
    if (globalTimer) {
        const globalDiff = (nowTs - new Date(globalTimer.lastUpdated).getTime()) / (1000 * 60);
        if (globalDiff >= 3) shouldFetch = true;
    } else {
        shouldFetch = true;
    }
} else {
    const lastUpdated = cache.lastUpdated || cache.updatedAt;
    const diffMins = (nowTs - new Date(lastUpdated).getTime()) / (1000 * 60);
    
    if (diffMins >= 3) {
        shouldFetch = true;
    } else {
        console.log(`✅ [Cache Hit] Data is fresh for ${m.home} (${diffMins.toFixed(1)} mins old).`);
    }
}

// ၂။ လိုအပ်မှ API ခေါ်မယ်
if (shouldFetch) {
    console.log(`📡 [API Call] Requesting update for ${m.home}...`);
    const freshFixtures = await syncAndNotify(m.fixtureId); 
    
    // syncAndNotify ထဲမှာ ၃ မိနစ်ထပ်စစ်တဲ့ logic (Global Lock) ပါဖို့ အရေးကြီးပါတယ်
    const freshMatch = freshFixtures.find(f => f.fixture.id === Number(m.fixtureId));
    
    if (freshMatch) {
        cache = {
            score: `${freshMatch.goals.home}-${freshMatch.goals.away}`,
            elapsed: freshMatch.fixture.status.elapsed,
            status: freshMatch.fixture.status.short,
            lastUpdated: new Date()
        };
    }else if (cache && !freshMatch) {
                // API ကနေ live data မရတော့ဘူးဆိုရင် (ပွဲပြီးလို့ list ထဲက ပျောက်သွားတာဖြစ်နိုင်)
                // အကယ်၍ ပွဲစခဲ့တာ ကြာပြီဆိုရင် FT လို့ သတ်မှတ်ပေးလိုက်မယ်
                const diffFromStart = (nowTs - matchTime.getTime()) / (1000 * 60 * 60);
                if (diffFromStart > 1.8) { // ၁ နာရီ ၄၅ မိနစ်ကျော်ရင် ပွဲပြီးပြီလို့ ယူဆ
                    cache.status = 'FT';
                    await LiveCache.updateOne({ fixtureId: m.fixtureId }, { status: 'FT' });
                }
            }
}
        // ၄။ ရလဒ် ထုတ်ပြခြင်း (Final Display)
      const scoreDisplay = cache ? `\`${cache.score}\`` : "`0-0` (Updating)";
        
        // Status အလိုက် စာသားပြောင်းလဲခြင်း
        let statusDisplay = "";
        if (cache) {
            switch (cache.status) {
                case 'HT':
                    statusDisplay = "🔴 *Half Time (ပိုင်းဝက်နားချိန်)*";
                    break;
                case 'FT':
                    statusDisplay = "🏁 *ပွဲပြီးဆုံးသွားပါပြီ (Full Time)*";
                    break;
                case '1H':
                case '2H':
                    statusDisplay = `⚽ *ပွဲကစားနေသည် (${cache.elapsed}')*`;
                    break;
                default:
                    statusDisplay = `🕒 *အခြေအနေ:* ${cache.status} (${cache.elapsed}')`;
            }
        } else {
            statusDisplay = "🕒 *အခြေအနေ:* ပွဲစတင်နေပါပြီ";
        }

        const msg = 
            `⚽️ *ပွဲစဉ်အသေးစိတ် (Live)*\n\n` +
            `🏆 *${escapeMarkdown(m.leagueName)}*\n` +
            `🆚 *${escapeMarkdown(m.home)}* vs *${escapeMarkdown(m.away)}*\n` +
            `🔢 ရလဒ်: ${scoreDisplay}\n` +
            `🕒 အခြေအနေ: *${statusDisplay}*`;

        return ctx.reply(msg, { 
            parse_mode: "Markdown", 
            reply_markup: new InlineKeyboard().text("🔔 Notification ယူမယ်", `sub_${m.fixtureId}`),
            message_thread_id: TARGET_TOPIC_ID 
        });

    } catch (err) {
        console.error("❌ Search Response Error:", err.message);
        return ctx.reply("⚠️ အချက်အလက်ရယူရာတွင် အမှားအယွင်းရှိနေပါသည်။");
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
    if (!m) return ctx.reply("❌ ပွဲစဉ်မတွေ့ပါ။");

    // User ရဲ့ အမည်ကို ယူမယ် (FirstName သို့မဟုတ် Username)
    const fullName = ctx.from.first_name + (ctx.from.last_name ? " " + ctx.from.last_name : "");
    const tgUsername = ctx.from.username || fullName; // username မရှိရင် နာမည်ကို သုံးမယ်

    await User.updateOne(
        { userId: ctx.from.id },
        { 
            $set: { 
                name: fullName, 
                username: ctx.from.username 
            },
            $addToSet: { 
                subscriptions: { 
                    fixtureId: fid, 
                    home: m.home, 
                    away: m.away, 
                    isStartedNotified: false 
                } 
            } 
        },
        { upsert: true }
    );
    
    return ctx.reply(`🔔 *${m.home}* ပွဲအတွက် Noti မှတ်သားပြီးပါပြီ။`, { parse_mode: "Markdown" });
}
    } catch (err) {
        console.error("❌ Callback Error:", err);
    }
}); /

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

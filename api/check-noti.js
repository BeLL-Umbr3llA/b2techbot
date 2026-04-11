require('dotenv').config();
const { Bot } = require("grammy");
const { connectDB, User, LiveCache, Match } = require("../db");

const bot = new Bot(process.env.BOT_TOKEN);
const APISPORTS_KEY = process.env.APISPORTS_KEY;
const GROUP_ID = process.env.GROUP_ID;
const TARGET_TOPIC_ID = process.env.TARGET_TOPIC_ID;
const TOP_LEAGUES =  [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];

// --- အဓိက Notification စစ်ဆေးပြီး Cache Update လုပ်မယ့် Function ---
const processAndNotify = async (fixtures) => {
    await connectDB();
    const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
    
    for (const m of fixtures) {
        const fid = m.fixture.id;
        const lid = m.league.id;
        const currentScore = `${m.goals.home}-${m.goals.away}`;

        // ၁။ Targeted Users ရှာမယ်
        const targetedUsers = usersWithSubs.filter(u => u.subscriptions.some(s => s.fixtureId === fid));
        const isTopLeague = TOP_LEAGUES.includes(lid);

        if (targetedUsers.length === 0 && !isTopLeague) continue;

        const mentionText = targetedUsers.map(u => `[${u.name || 'User'}](tg://user?id=${u.userId})`).join(' ');
        const mentionPrefix = mentionText ? `\n\n🔔 Notifications for: ${mentionText}` : "";

        // ၂။ လက်ရှိ Cache ကို အရင်ယူမယ်
        const oldLive = await LiveCache.findOne({ fixtureId: fid });

        // (A) Kick Off Notification - အခြေအနေသစ်စစ်ဆေးချက်
        // Cache လုံးဝမရှိသေးဘူး သို့မဟုတ် status က NS (Not Started) ကနေ တခြားတစ်ခုခု ပြောင်းသွားရင်
        if (!oldLive && m.fixture.status.short !== 'NS') {
            const kickOffMsg = `🎬 *Kick Off - ပွဲစပါပြီ!*\n\n🏟️ *${m.teams.home.name}* vs *${m.teams.away.name}*\n🏆 ${m.league.name}${mentionPrefix}`;
            await bot.api.sendMessage(GROUP_ID, kickOffMsg, { parse_mode: "Markdown", message_thread_id: TARGET_TOPIC_ID }).catch(() => {});
        }

        // (B) Goal Notification
        if (oldLive && oldLive.score !== currentScore) {
            // API response မှာ events မပါလာခဲ့ရင် error မတက်အောင် default ပြမယ်
            const lastGoal = (m.events && Array.isArray(m.events)) ? m.events.filter(e => e.type === "Goal").pop() : null;
            const scoringTeamLogo = (lastGoal?.team?.name === m.teams.home.name) ? m.teams.home.logo : m.teams.away.logo;

            const goalMsg = `⚽ *GOAL!!! (ဂိုးဝင်သွားပါပြီ)*\n\n🥅 *${m.teams.home.name}* ${currentScore} *${m.teams.away.name}*\n👤 Scorer: *${lastGoal?.player?.name || "N/A"}*\n🕒 Time: ${m.fixture.status.elapsed}'${mentionPrefix}`;

            // Image ပို့မရရင် စာသားပဲပို့ဖို့ fallback လုပ်ထားတယ်
            try {
                await bot.api.sendPhoto(GROUP_ID, scoringTeamLogo || m.teams.home.logo, {
                    caption: goalMsg,
                    parse_mode: "Markdown",
                    message_thread_id: TARGET_TOPIC_ID
                });
            } catch (e) {
                await bot.api.sendMessage(GROUP_ID, goalMsg, { parse_mode: "Markdown", message_thread_id: TARGET_TOPIC_ID });
            }
        }

        // (C) Live Cache Update - အမြဲတမ်း နောက်ဆုံးရလဒ်ကို Update လုပ်မယ်
        await LiveCache.findOneAndUpdate(
            { fixtureId: fid },
            {
                home: m.teams.home.name,
                away: m.teams.away.name,
                score: currentScore,
                elapsed: m.fixture.status.elapsed,
                status: m.fixture.status.short,
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );
    }
};

// --- Vercel Handler ---
module.exports = async (req, res) => {
    try {
        await connectDB();

        // ၁။ တခြားနေရာ (Bot) ကနေ POST နဲ့ Data လှမ်းပို့လာရင်
        if (req.method === 'POST') {
            const { fixtures } = req.body;
            if (fixtures && Array.isArray(fixtures)) {
                await processAndNotify(fixtures);
                console.log("Data synced and updated");
                return res.status(200).send("Data synced and updated.");
            }
            return res.status(400).send("Invalid fixtures data.");
        }
        
        // ၂။ Cron Job (GET) နဲ့ နှိုးလာရင် (Schedule အရ ဝင်လာတာ)
if (req.method === 'GET') {
    const now = new Date();

    // (က) Subscription ရှိတဲ့ User ရှိမှ ဆက်သွားမယ်
    const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
    if (usersWithSubs.length === 0) {
        return res.status(200).send("Cron: No subscriptions found. Skipping API call.");
    }

    // (ခ) Sub ထားတဲ့ Fixture ID တွေကို စုမယ်
    const subFixtureIds = [...new Set(usersWithSubs.flatMap(u => u.subscriptions.map(s => s.fixtureId)))];

    // (ဂ) အဲဒီထဲကမှ ပွဲစချိန် ရောက်နေပြီဖြစ်တဲ့ ပွဲတွေ DB ထဲမှာ ရှိ၊ မရှိ စစ်မယ်
    const activeMatches = await Match.find({ 
        fixtureId: { $in: subFixtureIds }, 
        utcDate: { $lte: now } // လက်ရှိအချိန်ထက် စချိန်က စောနေရမယ် (ပွဲစနေမှ)
    });

    if (activeMatches.length === 0) {
        return res.status(200).send("Cron: No active subbed matches right now. Skipping API call.");
    }

    // --- အထက်က အဆင့်တွေ အောင်မြင်မှ API ကို လှမ်းခေါ်မယ် ---
    console.log("📡 Cron: Active sub-matches found. Fetching Live API...");
    const resData = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
        headers: { 'x-apisports-key': APISPORTS_KEY }
    }).then(r => r.json());

    if (resData.response && resData.response.length > 0) {
        await processAndNotify(resData.response);
        return res.status(200).send("Cron sync completed.");
    }
}
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
};

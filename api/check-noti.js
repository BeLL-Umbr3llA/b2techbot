require('dotenv').config();
const { Bot } = require("grammy");
const { connectDB, User, LiveCache, Match,ApiLog } = require("../db");

const bot = new Bot(process.env.BOT_TOKEN);
const APISPORTS_KEY = process.env.APISPORTS_KEY;
const GROUP_ID = process.env.GROUP_ID || -1003726917388;
const TARGET_TOPIC_ID = process.env.TARGET_TOPIC_ID || 2;
const TOP_LEAGUES = [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];

const escapeMarkdown = (text) => {
    if (!text) return "";
    return text.replace(/[_*`[\]()]/g, '\\$&'); // Markdown character တွေကို escape လုပ်ပေးတာပါ
};

const processAndNotify = async (fixtures) => {
    await connectDB();
    const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
    
    console.log(`📥 Processing ${fixtures.length} fixtures...`);

    for (const m of fixtures) {
        const fid = m.fixture.id;
        const currentScore = `${m.goals.home}-${m.goals.away}`;
        const matchStatus = m.fixture.status.short; 
        const elapsed = m.fixture.status.elapsed || 0;

        // ဒီပွဲကို Sub လုပ်ထားတဲ့ User တွေကိုပဲ စစ်မယ်
        const targetedUsers = usersWithSubs.filter(u => u.subscriptions.some(s => s.fixtureId === fid));

        // အရေးကြီးဆုံးအချက်- Sub လုပ်ထားတဲ့သူ မရှိရင် ဘာ Noti မှ မပို့ဘဲ ကျော်သွားမယ်
        if (targetedUsers.length === 0) {
            // Cache Update တော့ လုပ်ချင်ရင် လုပ်နိုင်ပါတယ်၊ ဒါပေမဲ့ Noti အပိုင်းကို ကျော်ဖို့ ဒီမှာ continue သုံးရမယ်
            // Cache ကိုပါ Update မလုပ်ချင်ရင် အောက်က update code ကိုပါ ကျော်ဖို့ ဒီနေရာမှာပဲ continue လုပ်ပါ
            
            // --- Cache Update Only (Optional) ---
            await LiveCache.findOneAndUpdate(
                { fixtureId: fid },
                { 
                    home: m.teams.home.name,
                    away: m.teams.away.name,
                    score: currentScore,
                    elapsed: elapsed,
                    status: matchStatus,
                    leagueId: m.league.id,
                    lastUpdated: new Date()
                },
                { upsert: true }
            );
             console.log("✅ Update process finished.");
            continue; 
        }
        
const oldLive = await LiveCache.findOne({ fixtureId: fid });

// (A) Kick Off Notification
if ((!oldLive || oldLive.status === 'NS') && matchStatus === '1H') {
    // ၁။ ဒီပွဲကို Subscribe လုပ်ထားတဲ့ User အားလုံးကို ဆွဲထုတ်မယ်
    const subscribers = await User.find({ "subscriptions.fixtureId": m.fixture.id });

    // ဟာသ Quotes များ (ပို့တိုင်း တစ်မျိုးပြောင်းနေအောင်)
    const funnyQuotes = [
        "💸 မွဲမလား၊ ချမ်းသာမလား ရင်ခုန်လိုက်တော့! ",
        "🧻 ရှုံးရင် ငိုဖို့ တစ်ရှူး အဆင်သင့်ရှိပါစေ! ",
        "🥘 ဟင်းအိုးတူးနေရင် Bot တာဝန်မယူပါ! ",
        "📢 နိုးကြဦး! ဖုန်းကြီးကိုင်ပြီး အိပ်ပျော်မနေနဲ့! "
    ];

    // ၂။ Group + Topic အလိုက် ခွဲခြားသိမ်းဆည်းမယ်
    const groupMap = {};

    subscribers.forEach(user => {
        const sub = user.subscriptions.find(s => s.fixtureId === m.fixture.id);
        
        if (sub && sub.chatId) {
            const key = `${sub.chatId}_${sub.topicId || 0}`;

            if (!groupMap[key]) {
                groupMap[key] = {
                    chatId: sub.chatId,
                    topicId: sub.topicId,
                    mentions: []
                };
            }

            // Markdown character တွေကို escape လုပ်ဖို့ မမေ့ပါနဲ့
            const safeName = (user.name || 'User').replace(/[_*`[\]()]/g, '\\$&');
            const mention = user.username 
                ? `@${user.username}` 
                : `[${safeName}](tg://user?id=${user.userId})`;
            
            groupMap[key].mentions.push(mention);
        }
    });

    // ၃။ Group အလိုက် စာပို့မယ်
    for (const key in groupMap) {
        const target = groupMap[key];
        
        // Random ဟာသ Quote တစ်ခု ယူမယ်
        const randomQuote = funnyQuotes[Math.floor(Math.random() * funnyQuotes.length)];
        
        const mentionText = target.mentions.length > 0 
            ? `\n\n🎯 *${randomQuote}*\n🔔 Noti: ${target.mentions.join(" ")}` 
            : "";

        const kickOffMsg = `🎬 *လူကြီးမင်းတို့ Noti ယူထားတဲ့\nပွဲစဉ် စပြီဗျို့......*\n\n` +
                           `🏟️ *${m.teams.home.name}* vs *${m.teams.away.name}*\n` +
                           `🏆 ${m.league.name}${mentionText}`;

        await bot.api.sendMessage(target.chatId, kickOffMsg, { 
            parse_mode: "Markdown", 
            message_thread_id: target.topicId || 0 
        }).catch(e => console.error(`Group Noti Error (${target.chatId}):`, e.message));
    }
}
        // (B) Goal Notification
       // (B) Goal Notification
if (oldLive && oldLive.score !== currentScore) {
    const [oldHome, oldAway] = oldLive.score.split('-').map(Number);
    const [curHome, curAway] = currentScore.split('-').map(Number);
    
    let scoringTeamName = (curHome > oldHome) ? m.teams.home.name : m.teams.away.name;
    let scoringTeamLogo = (curHome > oldHome) ? m.teams.home.logo : m.teams.away.logo;

    const lastGoalEvent = (m.events && Array.isArray(m.events)) 
                        ? m.events.filter(e => e.type === "Goal").pop() 
                        : null;
    const scorerName = lastGoalEvent?.player?.name || "ဂိုးဝင်သွားသည်";

    // ၁။ Subscribe လုပ်ထားတဲ့ User တွေကို ရှာပြီး Group လိုက် စုစည်းမယ်
    const subscribers = await User.find({ "subscriptions.fixtureId": m.fixture.id });
    const groupMap = {};

    subscribers.forEach(user => {
        const sub = user.subscriptions.find(s => s.fixtureId === m.fixture.id);
        if (sub && sub.chatId) {
            const key = `${sub.chatId}_${sub.topicId || 0}`;
            if (!groupMap[key]) {
                groupMap[key] = {
                    chatId: sub.chatId,
                    topicId: sub.topicId,
                    mentions: []
                };
            }
            const mention = user.username 
                ? `@${user.username}` 
                : `[${user.name || 'User'}](tg://user?id=${user.userId})`;
            groupMap[key].mentions.push(mention);
        }
    });

    // ၂။ စုစည်းထားတဲ့ Group တစ်ခုချင်းစီကို ပုံနဲ့တကွ Noti ပို့မယ်
    for (const key in groupMap) {
        const target = groupMap[key];
     const goalQuotes = [
        "💸 *ဒီဂိုးလေးသာ ဆက်ထိန်းထားရင် မနက်ဖြန် မာလာရှမ်းကော စားရပြီ!*",
        "🧻 *ဟိုဘက်အသင်းကလူတွေ တစ်ရှူး အထုပ်လိုက် ပြင်ထားတော့!*",
        "🍔 *ဒီညတော့ မာမား မစားရတော့ဘူး ထင်တယ်နော်!*",
        "💔 *ဒီဂိုးက ရည်းစားထားတာထက်တောင် ပိုရင်ခုန်ဖို့ ကောင်းတယ်!*",
        "🥘 *မာလာရှမ်းကောတင် မကဘူး၊ နက်ဖြန် တစ်ဝိုင်းလုံး ငါဒိုင်ခံမယ်!*",
        "👸 *ဂိုးမြင်ရတာ မယားငယ်ရသလို ရင်ခုန်လိုက်တာ!*"
    ];

    const randomGoalQuote = goalQuotes[Math.floor(Math.random() * goalQuotes.length)];

    // mentionText ထဲမှာ quote ကို တိုက်ရိုက်ထည့်လိုက်ပါ (quote ထဲမှာ bold ပါပြီးသားမို့လို့ပါ)
    const mentionText = target.mentions.length > 0 
        ? `\n\n🎯 ${randomGoalQuote}\n🔔 Noti: ${target.mentions.join(" ")}` 
        : "";

    const goalMsg = `⚽ *GOAL!!! (ဂိုးဝင်သွားပါပြီ)*\n\n` +
                    `🥅 *${m.teams.home.name}* ${currentScore} *${m.teams.away.name}*\n` +
                    `🚩 Scoring Team: *${scoringTeamName}*\n` +
                    `👤 Scorer: *${scorerName}*\n` +
                    `🕒 Time: ${matchStatus} (${elapsed}')${mentionText}`;

        try {
            // Photo ပို့တဲ့အခါ သက်ဆိုင်ရာ chatId နဲ့ topicId သုံးမယ်
            await bot.api.sendPhoto(target.chatId, scoringTeamLogo || m.teams.home.logo, {
                caption: goalMsg,
                parse_mode: "Markdown",
                message_thread_id: target.topicId || 0
            });
        } catch (e) {
            // Photo ပို့မရရင် စာသားပဲ ပို့မယ်
            await bot.api.sendMessage(target.chatId, goalMsg, { 
                parse_mode: "Markdown", 
                message_thread_id: target.topicId || 0 
            }).catch(err => console.error(`Goal Noti Send Error (${target.chatId}):`, err.message));
        }
    }
}

        // (C) Live Cache Update (Sub လုပ်ထားသူ ရှိတဲ့ပွဲများအတွက်)
        await LiveCache.findOneAndUpdate(
            { fixtureId: fid },
            {
                home: m.teams.home.name,
                away: m.teams.away.name,
                score: currentScore,
                elapsed: elapsed,
                status: matchStatus,
                lastUpdated: new Date()
            },
            { upsert: true }
        );
    }
    console.log("✅ Update process finished.");
};

module.exports = async (req, res) => {
    try {
        await connectDB();
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();

        // --- ဒီနေရာမှာ အမှိုက်အရင်ရှင်းမယ် (Cleanup Logic) ---
        const threeHoursAgo = new Date(now.getTime() - (120 * 60 * 1000));
        
        console.log("🧹 Starting backup cleanup...");
        
        // ၁။ ပွဲစချိန် ၃ နာရီကျော်နေတဲ့ sub တွေကို ဖယ်ထုတ်မယ်
        await User.updateMany(
            { "subscriptions.startTime": { $lte: threeHoursAgo } },
            { $pull: { subscriptions: { startTime: { $lte: threeHoursAgo } } } }
        );

        // ၂။ ပွဲဟောင်းတွေကို Match နဲ့ Cache ထဲက ရှင်းမယ်
        await Match.deleteMany({ utcDate: { $lte: threeHoursAgo } });
        await LiveCache.deleteMany({ 
            $or: [
                { lastUpdated: { $lte: threeHoursAgo }, status: { $in: ['FT', 'AET', 'PEN'] } },
                { type: { $ne: "global_sync_timer" }, lastUpdated: { $lte: threeHoursAgo } } // timer မဟုတ်တဲ့ ၃ နာရီကျော် data တွေအကုန်ဖြုတ်
            ]
        });

        // ၃။ Sub မရှိတော့တဲ့ User တွေကို ဖျက်မယ်
        await User.deleteMany({ subscriptions: { $size: 0 } });
        
        console.log("✅ Cleanup finished.");
        
        if (req.method === 'POST') {
            console.log("🚀 Incoming POST Request");

            await ApiLog.findOneAndUpdate(
                { date: today },
                { $inc: { api1_count: 1 } },
                { upsert: true }
            );
            const { fixtures } = req.body;
            
            if (fixtures && Array.isArray(fixtures)) {
                // Background ထက်စာရင် await သုံးပြီး log ကို အရင်စစ်ကြည့်ပါ (Debug အတွက်)
                await processAndNotify(fixtures); 
                return res.status(200).json({ success: true, count: fixtures.length });
            }
            return res.status(400).send("Invalid fixtures data.");
        }
        
        if (req.method === 'GET') {
            console.log("🚀 Incoming GET (Cron) Request");
            const now = new Date();
         

              // 1. အရင်ဆုံး Global Timer ကို စစ်ဆေးမယ်
            const globalSync = await LiveCache.findOne({ type: "global_sync_timer" });
    
            if (globalSync && globalSync.lastUpdated) {
                const lastUpdate = new Date(globalSync.lastUpdated);
                const diffInMs = now - lastUpdate;
                const oneMinute = 60 * 1000; // 60,000 ms

        if (diffInMs < oneMinute) {
            console.log(`⏳ Skip: Last sync was only ${Math.round(diffInMs / 1000)}s ago.`);
            return res.status(200).send("Cron: Skipped, too soon.");
        }
    }

         const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
            if (usersWithSubs.length === 0) {
                console.log("⚠️ No subscriptions found.");
                return res.status(200).send("Cron: No subscriptions found.");
            }

            const subFixtureIds = [...new Set(usersWithSubs.flatMap(u => u.subscriptions.map(s => s.fixtureId)))];
            const activeMatches = await Match.find({ 
                fixtureId: { $in: subFixtureIds }, 
                utcDate: { $lte: now } 
            });

            if (activeMatches.length === 0) {
                console.log("⚠️ No active subbed matches found.");
                return res.status(200).send("Cron: No active subbed matches.");
            }

            console.log("📡 Fetching from API Sports...");
            const apiRes = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
                headers: { 'x-apisports-key': APISPORTS_KEY }
            });
            const resData = await apiRes.json();
            if (apiRes.ok) { // API ခေါ်တာ အောင်မြင်မှသာ မှတ်မယ်
               await ApiLog.findOneAndUpdate(
                    { date: today },
                    { $inc: { api2_count: 1 } },
                    { upsert: true }
                );
                }
            if (resData.response && resData.response.length > 0) {
                await LiveCache.findOneAndUpdate(
                    { type: "global_sync_timer" },
                    { lastUpdated: now },
                    { upsert: true }
                );
                console.log("⏰ Global timer updated.");


            const topLeagueMatches = resData.response.filter(match => 
            TOP_LEAGUES.includes(match.league.id) );

                console.log(`📊 Filtered: ${topLeagueMatches.length} Top League matches.`);

                // ၅။ စစ်ထုတ်ထားတဲ့ ပွဲတွေကိုပဲ processAndNotify ထံ ပို့မယ်
                // (မှတ်ချက် - သိမ်းဆည်းခြင်း logic ကို processAndNotify ထဲမှာ ထည့်ထားရပါမယ်)
                await processAndNotify(topLeagueMatches);
    
                return res.status(200).send("Cron sync completed.");
            }
            return res.status(200).send("No live data from API.");
        }
    } catch (err) {
        console.error("❌ Error:", err.message);
        res.status(500).send(err.message);
    }
};

require('dotenv').config();
const { Bot } = require("grammy");
const { connectDB, User, LiveCache, Match } = require("../db");

const bot = new Bot(process.env.BOT_TOKEN);
const APISPORTS_KEY = process.env.APISPORTS_KEY;
const GROUP_ID = process.env.GROUP_ID || -1003726917388;
const TARGET_TOPIC_ID = process.env.TARGET_TOPIC_ID || 2;
const TOP_LEAGUES = [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];
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
                    lastUpdated: new Date()
                },
                { upsert: true }
            );
             console.log("✅ Update process finished.");
            continue; 
        }

        const mentionText = targetedUsers.map(u => `[${u.name || 'User'}](tg://user?id=${u.userId})`).join(' ');
        const mentionPrefix = mentionText ? `\n\n🔔 Notifications for: ${mentionText}` : "";

        const oldLive = await LiveCache.findOne({ fixtureId: fid });

        // (A) Kick Off Notification
        if ((!oldLive || oldLive.status === 'NS') && matchStatus === '1H') {
            const kickOffMsg = `🎬 *Kick Off - ပွဲစပါပြီ!*\n\n🏟️ *${m.teams.home.name}* vs *${m.teams.away.name}*\n🏆 ${m.league.name}${mentionPrefix}`;
            await bot.api.sendMessage(GROUP_ID, kickOffMsg, { 
                parse_mode: "Markdown", 
                message_thread_id: TARGET_TOPIC_ID 
            }).catch(e => console.error("KickOff Send Error:", e.message));
        }

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

            const goalMsg = `⚽ *GOAL!!! (ဂိုးဝင်သွားပါပြီ)*\n\n🥅 *${m.teams.home.name}* ${currentScore} *${m.teams.away.name}*\n🚩 Scoring Team: *${scoringTeamName}*\n👤 Scorer: *${scorerName}*\n🕒 Time: ${matchStatus} (${elapsed}')${mentionPrefix}`;

            try {
                await bot.api.sendPhoto(GROUP_ID, scoringTeamLogo || m.teams.home.logo, {
                    caption: goalMsg,
                    parse_mode: "Markdown",
                    message_thread_id: TARGET_TOPIC_ID
                });
            } catch (e) {
                await bot.api.sendMessage(GROUP_ID, goalMsg, { 
                    parse_mode: "Markdown", 
                    message_thread_id: TARGET_TOPIC_ID 
                });
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

        if (req.method === 'POST') {
            console.log("🚀 Incoming POST Request");
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

            if (resData.response && resData.response.length > 0) {
                await LiveCache.findOneAndUpdate(
                    { type: "global_sync_timer" },
                    { lastUpdated: now },
                    { upsert: true }
                );
                console.log("⏰ Global timer updated.");
                await processAndNotify(resData.response);
                return res.status(200).send("Cron sync completed.");
            }
            return res.status(200).send("No live data from API.");
        }
    } catch (err) {
        console.error("❌ Error:", err.message);
        res.status(500).send(err.message);
    }
};

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
    
    // index.js မှ data ရောက်မရောက် စစ်ဆေးရန်
    console.log(`📥Youk dl Processing ${fixtures.length} fixtures from POST request...`);

    for (const m of fixtures) {
        const fid = m.fixture.id;
        const lid = m.league.id;
        const currentScore = `${m.goals.home}-${m.goals.away}`;
        const matchStatus = m.fixture.status.short; // ဥပမာ- 1H, 2H, HT
        const elapsed = m.fixture.status.elapsed || 0;

        const targetedUsers = usersWithSubs.filter(u => u.subscriptions.some(s => s.fixtureId === fid));
        const isTopLeague = TOP_LEAGUES.includes(lid);

        if (targetedUsers.length === 0 && !isTopLeague) continue;

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
            
            let scoringTeamName = "";
            let scoringTeamLogo = "";

            if (curHome > oldHome) {
                scoringTeamName = m.teams.home.name;
                scoringTeamLogo = m.teams.home.logo;
            } else if (curAway > oldAway) {
                scoringTeamName = m.teams.away.name;
                scoringTeamLogo = m.teams.away.logo;
            }

            const lastGoalEvent = (m.events && Array.isArray(m.events)) 
                                  ? m.events.filter(e => e.type === "Goal").pop() 
                                  : null;
            const scorerName = lastGoalEvent?.player?.name || "ဂိုးဝင်သွားသည်";

            // undefined မဖြစ်အောင် matchStatus ကို သေချာသုံးထားပါတယ်
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

        // (C) Live Cache Update
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
             console.log("working POST");
            const { fixtures } = req.body;
            if (fixtures && Array.isArray(fixtures)) {
                // Background မှာ run မယ်၊ response ကို ချက်ချင်းပြန်မယ်
                processAndNotify(fixtures).catch(e => console.error("Async Process Error:", e.message));
                return res.status(200).json({ success: true, message: `Received ${fixtures.length} matches` });
            }
            return res.status(400).send("Invalid fixtures data.");
        }
        
        if (req.method === 'GET') {
               console.log("working Get");
            const now = new Date();
            const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
            
            if (usersWithSubs.length === 0) {
                return res.status(200).send("Cron: No subscriptions found.");
                   console.log("User ma shi pr");
            }

            const subFixtureIds = [...new Set(usersWithSubs.flatMap(u => u.subscriptions.map(s => s.fixtureId)))];
            const activeMatches = await Match.find({ 
                fixtureId: { $in: subFixtureIds }, 
                utcDate: { $lte: now } 
            });

            if (activeMatches.length === 0) {
                return res.status(200).send("Cron: No active subbed matches.");
                   console.log("ပွဲမစသေးပါ");
            }
            console.log("api ခေါ်ပါပြီ");
            const resData = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
                headers: { 'x-apisports-key': APISPORTS_KEY }
            }).then(r => r.json());

            if (resData.response && resData.response.length > 0) {
                await LiveCache.findOneAndUpdate(
                    { type: "global_sync_timer" },
                    { lastUpdated: now },
                    { upsert: true }
                );
                 console.log("Global sync ပြီးပီ");
                await processAndNotify(resData.response);
                return res.status(200).send("Cron sync completed.");
            }
            return res.status(200).send("No live data from API.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
};

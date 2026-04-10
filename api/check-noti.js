require('dotenv').config();
const { Bot } = require("grammy");
const { connectDB, User, LiveCache, Match } = require("../db");
const bot = new Bot(process.env.BOT_TOKEN);
const APISPORTS_KEY = process.env.APISPORTS_KEY;

const GROUP_ID = process.env.GROUP_ID || -1003726917388; // -100...
const TARGET_TOPIC_ID = process.env.TARGET_TOPIC_ID || 2; // Topic (Thread) ID
const TOP_LEAGUES = [39, 140, 135, 78, 61, 2, 1]; // EPL, La Liga, Serie A
const checkNoti = async () => {
    try {
        await connectDB();
        const now = new Date();

        const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
        if (usersWithSubs.length === 0) return { status: "No subscriptions found." };

        const subFixtureIds = [...new Set(usersWithSubs.flatMap(u => u.subscriptions.map(s => s.fixtureId)))];

        const activeMatches = await Match.find({ 
            fixtureId: { $in: subFixtureIds },
            utcDate: { $lte: now }
        });

        if (activeMatches.length === 0) return { status: "No active tracked matches right now." };

        console.log("📡 Fetching Live Data...");
        const resData = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
            headers: { 'x-apisports-key': APISPORTS_KEY }
        }).then(r => r.json());
        
    
        
    for (const m of resData.response) {
    const fid = m.fixture.id;
    const lid = m.league.id;

    // ၁။ ဒီပွဲကို Noti ဖွင့်ထားတဲ့ User ရှိမရှိ စစ်မယ်
    const targetedUsers = usersWithSubs.filter(u => u.subscriptions.some(s => s.fixtureId === fid));
    
    // ၂။ ဒါက နာမည်ကြီး League လား စစ်မယ်
    const isTopLeague = TOP_LEAGUES.includes(lid);

    // Noti ဖွင့်ထားသူလည်းမရှိ၊ Top League လည်းမဟုတ်ရင် ကျော်သွားမယ်
    if (targetedUsers.length === 0 && !isTopLeague) continue;

    // --- Database ထဲမှာ အခြေအနေဟောင်းကို ရှာမယ် ---
    const oldLive = await LiveCache.findOne({ fixtureId: fid });

    // --- (A) ပွဲစကြောင်း Notification ပို့ခြင်း ---
    // Database ထဲမှာ မရှိသေးဘူးဆိုရင် ပွဲစတာသေချာသလောက်ရှိတယ် (Kick Off)
    if (!oldLive) {
        const kickOffMsg = `🎬 *Kick Off - ပွဲစပါပြီ!*\n\n` +
                           `🏟️ *${m.teams.home.name}* vs *${m.teams.away.name}*\n` +
                           `🏆 ${m.league.name}`;

        // Group ထဲက Topic ဆီသို့ ပို့မယ်
        await bot.api.sendMessage(GROUP_ID, kickOffMsg, { 
            parse_mode: "Markdown", 
            message_thread_id: TARGET_TOPIC_ID 
        }).catch(e => console.error("Kickoff Error:", e));
    }

                // --- ၂။ Goal Notification (Logo ပုံနဲ့ သေသေသပ်သပ်) ---
                const currentScore = `${m.goals.home}-${m.goals.away}`;
                if (oldLive && oldLive.score !== currentScore) {
                    
                    // နောက်ဆုံး Event ထဲက Goal ကို ရှာမယ်
                    const lastGoal = m.events ? m.events.filter(e => e.type === "Goal").pop() : null;
                    
                    // ဘယ်အသင်း ဂိုးသွင်းတာလဲဆိုတာ ခွဲခြားမယ် (Logo ပြဖို့အတွက်)
                    const scoringTeamName = lastGoal?.team?.name;
                    const scoringTeamLogo = (scoringTeamName === m.teams.home.name) 
                                            ? m.teams.home.logo 
                                            : m.teams.away.logo;

                    const goalMsg = `⚽ *GOAL!!! (ဂိုးဝင်သွားပါပြီ)*\n\n` +
                                   `🥅 *${m.teams.home.name}* ${currentScore}  *${m.teams.away.name}*\n\n` +
                                   `👤 Scorer: *${lastGoal?.player?.name || "N/A"}*\n` +
                                   `🕒 Time: ${m.fixture.status.elapsed}' (Minute)`;

                    // Logo ပုံကို အရင်ပို့ပြီး စာသားကို Caption မှာ ထည့်မယ်
                    
                  await bot.api.sendPhoto(GROUP_ID, scoringTeamLogo, {
                    caption: goalMsg,
                    parse_mode: "Markdown",
                    message_thread_id: TARGET_TOPIC_ID 
                }).catch(e => console.error("Goal Photo Error:", e.message));
            }
            }

            // Cache Update
            await LiveCache.findOneAndUpdate(
                { fixtureId: fid }, 
                {   
                    home: m.teams.home.name,    // ထပ်ဖြည့်လိုက်ပါ
                    away: m.teams.away.name,    // ထပ်ဖြည့်လိုက်ပါ
                    score: `${m.goals.home}-${m.goals.away}`,
                    elapsed: m.fixture.status.elapsed,
                    lastUpdated: new Date()
                }, 
                { upsert: true }
            );
        }
        return { status: "Success" };
    } catch (err) {
        return { status: "Error", error: err.message };
    }
};

// Handler settings...
module.exports = async (req, res) => {
    const result = await checkNoti();
    res.status(result.error ? 500 : 200).send(result.status);
};

if (require.main === module) {
    checkNoti().then(res => console.log(res.status));
}
